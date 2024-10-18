const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const token = '6845291404:AAFwsPGqdbSOjx19EVXjjh4EnUQD1v1vJlc';
const bot = new TelegramBot(token, { polling: true });

const STATES = {
    IDLE: 'IDLE',
    WAITING_USERNAME: 'WAITING_USERNAME',
    WAITING_PASSWORD: 'WAITING_PASSWORD',
    WAITING_CALLER_ID: 'WAITING_CALLER_ID'
};

const userStates = new Map();
const userSessions = new Map();

let browser;

(async () => {
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ],
        defaultViewport: { width: 1920, height: 1080 }
    });
})();
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    userStates.set(chatId, STATES.IDLE);
    
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'تسجيل الدخول', callback_data: 'login' }]
            ]
        }
    };
    
    bot.sendMessage(chatId, 'مرحباً بك في بوت تغيير معرف المتصل\nاضغط على زر تسجيل الدخول للبدء', opts);
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (data === 'login') {
        userStates.set(chatId, STATES.WAITING_USERNAME);
        bot.sendMessage(chatId, 'الرجاء إدخال اسم المستخدم:');
    }
});

async function performLoginWithRetry(username, password, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await performLogin(username, password);
        } catch (error) {
            console.error(`Login attempt ${i + 1} failed:`, error);
            if (i === maxRetries - 1) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
        }
    }
}

async function performLogin(username, password) {
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('جاري الانتقال إلى صفحة تسجيل الدخول...');
        await page.goto('http://sip.vipcaller.net/mbilling/', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // التقاط صورة لصفحة تسجيل الدخول
        const loginScreenshot = await page.screenshot({ fullPage: true });

        // انتظار ظهور نموذج تسجيل الدخول
        await page.waitForSelector('input[name="userid"]', { visible: true, timeout: 30000 });
        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 30000 });
        
        console.log('إدخال بيانات الاعتماد...');
        
        // مسح وإدخال اسم المستخدم
        await page.evaluate(() => {
            document.querySelector('input[name="userid"]').value = '';
        });
        await page.type('input[name="userid"]', username, { delay: 100 });

        // مسح وإدخال كلمة المرور
        await page.evaluate(() => {
            document.querySelector('input[name="password"]').value = '';
        });
        await page.type('input[name="password"]', password, { delay: 100 });

        // انتظار لحظة قبل النقر
        await page.waitForTimeout(1000);

        console.log('الضغط على زر تسجيل الدخول...');
        
        // العثور على زر تسجيل الدخول بشكل أكثر دقة
        const loginButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('.x-btn'));
            const loginBtn = buttons.find(btn => {
                const text = btn.textContent.toLowerCase();
                return text.includes('login') || text.includes('تسجيل الدخول');
            });
            return loginBtn;
        });

        if (!loginButton) {
            throw new Error('لم يتم العثور على زر تسجيل الدخول');
        }

        // النقر على الزر وانتظار التحميل
        await Promise.all([
            loginButton.click(),
            page.waitForResponse(
                response => response.url().includes('mbilling') && response.status() === 200,
                { timeout: 30000 }
            )
        ]);

        // انتظار لحظة للتأكد من اكتمال التحميل
        await page.waitForTimeout(3000);

        // التحقق من نجاح تسجيل الدخول بعدة طرق
        const isLoggedIn = await page.evaluate(() => {
            // التحقق من وجود عناصر القائمة
            const hasMenu = document.querySelector('.x-menu-item-text') !== null;
            
            // التحقق من وجود اسم المستخدم في الواجهة
            const hasUserInfo = document.querySelector('.x-panel-header-title') !== null;
            
            // التحقق من URL الصفحة
            const correctURL = window.location.href.includes('/mbilling/') && 
                             !window.location.href.includes('login');
            
            // التحقق من عدم وجود رسائل خطأ
            const noErrors = !document.body.innerText.includes('Invalid') && 
                           !document.body.innerText.includes('خطأ');

            return hasMenu || hasUserInfo || (correctURL && noErrors);
        });

        if (isLoggedIn) {
            console.log('تم تسجيل الدخول بنجاح');
            // التأكد من اكتمال تحميل الصفحة
            await page.waitForSelector('.x-panel', { timeout: 10000 });
            return { success: true, page, loginScreenshot };
        } else {
            console.log('فشل تسجيل الدخول');
            await page.screenshot({ path: 'login-failed.png' });
            return { 
                success: false, 
                error: 'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد.',
                loginScreenshot
            };
        }

    } catch (error) {
        console.error('خطأ في عملية تسجيل الدخول:', error);
        const errorScreenshot = await page.screenshot();
        throw new Error(`فشل تسجيل الدخول: ${error.message}`);
    }
}

// تحديث جزء معالجة الرسائل لإرسال الصورة
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        const state = userStates.get(chatId);
        
        switch (state) {
            case STATES.WAITING_USERNAME:
                userSessions.set(chatId, { username: msg.text });
                userStates.set(chatId, STATES.WAITING_PASSWORD);
                bot.sendMessage(chatId, 'الرجاء إدخال كلمة المرور:');
                break;.
            
            case STATES.WAITING_PASSWORD:
                const statusMessage = await bot.sendMessage(chatId, 'جاري تسجيل الدخول... ⏳');
                const session = userSessions.get(chatId);
                session.password = msg.text;
                
                try {
                    const loginResult = await performLoginWithRetry(session.username, session.password);
                    if (loginResult.success) {
                        userStates.set(chatId, STATES.WAITING_CALLER_ID);
                        session.page = loginResult.page;
                        userSessions.set(chatId, session);
                        
                        // إرسال صورة صفحة تسجيل الدخول
                        await bot.sendPhoto(chatId, loginResult.loginScreenshot, { caption: 'صورة صفحة تسجيل الدخول' });
                        
                        bot.editMessageText('✅ تم تسجيل الدخول بنجاح!\nالرجاء إدخال معرف المتصل الجديد:', {
                            chat_id: chatId,
                            message_id: statusMessage.message_id
                        });
                    } else {
                        userStates.set(chatId, STATES.IDLE);
                        
                        // إرسال صورة صفحة تسجيل الدخول في حالة الفشل أيضًا
                        await bot.sendPhoto(chatId, loginResult.loginScreenshot, { caption: 'صورة صفحة تسجيل الدخول (فشل تسجيل الدخول)' });
                        
                        bot.editMessageText(`❌ فشل تسجيل الدخول. ${loginResult.error}\nيرجى التحقق من بيانات الاعتماد والمحاولة مرة أخرى.`, {
                            chat_id: chatId,
                            message_id: statusMessage.message_id
                        });
                    }
                } catch (error) {
                    console.error('خطأ في تسجيل الدخول:', error);
                    bot.editMessageText(`❌ حدث خطأ أثناء محاولة تسجيل الدخول. ${error.message}\nيرجى المحاولة مرة أخرى لاحقًا أو الاتصال بالدعم الفني.`, {
                        chat_id: chatId,
                        message_id: statusMessage.message_id
                    });
                    userStates.set(chatId, STATES.IDLE);
                }
                break;
            case STATES.WAITING_CALLER_ID:
                const updateMessage = await bot.sendMessage(chatId, 'جاري تغيير معرف المتصل... ⏳');
                const currentSession = userSessions.get(chatId);
                
                try {
                    const updateResult = await updateCallerId(currentSession.page, msg.text);
                    if (updateResult.success) {
                        bot.editMessageText(`✅ تم تغيير معرف المتصل بنجاح إلى: ${msg.text}`, {
                            chat_id: chatId,
                            message_id: updateMessage.message_id
                        });
                    } else {
                        bot.editMessageText(`❌ فشل تغيير معرف المتصل. ${updateResult.error}`, {
                            chat_id: chatId,
                            message_id: updateMessage.message_id
                        });
                    }
                } catch (error) {
                    console.error('خطأ في تغيير معرف المتصل:', error);
                    bot.editMessageText(`❌ حدث خطأ أثناء محاولة تغيير معرف المتصل. ${error.message}`, {
                        chat_id: chatId,
                        message_id: updateMessage.message_id
                    });
                }
                
                userStates.set(chatId, STATES.IDLE);
                if (currentSession.page) {
                    await currentSession.page.close();
                }
                userSessions.delete(chatId);
                break;
        }
    }
});
// ... [Rest of the code remains the same] ...
async function updateCallerId(page, newCallerId) {
    try {
        await page.goto('http://sip.vipcaller.net/mbilling/user/profile', {
            waitUntil: 'networkidle0',
            timeout: 120000
        });

        console.log('Profile page URL:', await page.url());

        await page.waitForSelector('input[name="CallerID"]', { visible: true, timeout: 120000 });

        await page.$eval('input[name="CallerID"]', el => el.value = '');
        await page.type('input[name="CallerID"]', newCallerId, { delay: 100 });

        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 })
        ]);

        const content = await page.content();
        console.log('After update content:', content);

        if (content.includes('success') || content.includes('تم التحديث بنجاح')) {
            return { success: true };
        } else {
            await page.screenshot({ path: 'update-failed.png', fullPage: true });
            return { success: false, error: 'فشل تحديث معرف المتصل. يرجى المحاولة مرة أخرى.' };
        }
    } catch (error) {
        console.error('خطأ في تحديث معرف المتصل:', error);
        await page.screenshot({ path: 'update-error.png', fullPage: true });
        throw new Error(`فشل تحديث معرف المتصل: ${error.message}`);
    }
}

process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});
