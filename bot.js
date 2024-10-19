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


bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        const state = userStates.get(chatId);
        
        switch (state) {
            case STATES.WAITING_USERNAME:
                userSessions.set(chatId, { username: msg.text });
                userStates.set(chatId, STATES.WAITING_PASSWORD);
                bot.sendMessage(chatId, 'الرجاء إدخال كلمة المرور:');
                break;
            case STATES.WAITING_PASSWORD:
                const statusMessage = await bot.sendMessage(chatId, 'جاري تسجيل الدخول... ⏳');
                const session = userSessions.get(chatId);
                session.password = msg.text;
                
                try {
                    const loginResult = await performLoginWithRetry(session.username, session.password);
                    
                    if (loginResult.loginScreenshot) {
                        await bot.sendPhoto(chatId, loginResult.loginScreenshot, { caption: 'صورة صفحة تسجيل الدخول' });
                    }
                    
                    if (loginResult.success) {
                        userStates.set(chatId, STATES.WAITING_CALLER_ID);
                        session.page = loginResult.page;
                        userSessions.set(chatId, session);
                        
                        if (loginResult.afterLoginScreenshot) {
                            await bot.sendPhoto(chatId, loginResult.afterLoginScreenshot, { caption: 'صورة بعد تسجيل الدخول الناجح' });
                        }
                        
                        bot.editMessageText('✅ تم تسجيل الدخول بنجاح!\nالرجاء إدخال معرف المتصل الجديد:', {
                            chat_id: chatId,
                            message_id: statusMessage.message_id
                        });
                    } else {
                        userStates.set(chatId, STATES.IDLE);
                        
                        if (loginResult.errorScreenshot) {
                            await bot.sendPhoto(chatId, loginResult.errorScreenshot, { caption: 'صورة صفحة الخطأ' });
                        } else if (loginResult.afterLoginScreenshot) {
                            await bot.sendPhoto(chatId, loginResult.afterLoginScreenshot, { caption: 'صورة بعد محاولة تسجيل الدخول (فشل)' });
                        }
                        
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
            if (error.screenshot) {
                await bot.sendPhoto(chatId, Buffer.from(error.screenshot, 'base64'), { caption: 'صورة الخطأ' });
            }
        }
        
        userStates.set(chatId, STATES.IDLE);
        if (currentSession.page) {
            await currentSession.page.close();
        }
        userSessions.delete(chatId);
        break;
            default:
                bot.sendMessage(chatId, 'عذرًا، لم أفهم طلبك. يرجى استخدام الأمر /start للبدء من جديد.');
        }
    }
});

// ... [Rest of the code remains the same] ...
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

        // انتظار ظهور حقول الإدخال
        await page.waitForSelector('input[name="userid"]', { visible: true, timeout: 30000 });
        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 30000 });
        
        console.log('إدخال بيانات الاعتماد...');
        
        await page.type('input[name="userid"]', username, { delay: 100 });
        await page.type('input[name="password"]', password, { delay: 100 });

        console.log('البحث عن زر تسجيل الدخول...');
        
        // البحث عن زر تسجيل الدخول باستخدام نص الزر
        const loginButtonSelector = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], .x-btn'));
            const loginBtn = buttons.find(btn => {
                const text = btn.textContent.toLowerCase();
                return text.includes('login') || text.includes('تسجيل الدخول') || text.includes('دخول');
            });
            if (loginBtn) {
                loginBtn.setAttribute('data-testid', 'login-button');
                return '[data-testid="login-button"]';
            }
            return null;
        });

        if (!loginButtonSelector) {
            throw new Error('لم يتم العثور على زر تسجيل الدخول');
        }

        console.log('الضغط على زر تسجيل الدخول...');
        
        // النقر على زر تسجيل الدخول وانتظار انتهاء التحميل
        await Promise.all([
            page.click(loginButtonSelector),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }).catch(() => console.log('تم انتهاء مهلة الانتظار للتنقل'))
        ]);

        // انتظار لحظة إضافية للتأكد من اكتمال تحميل الصفحة
        await page.waitForTimeout(5000);

        // التقاط صورة بعد محاولة تسجيل الدخول
        const afterLoginScreenshot = await page.screenshot({ fullPage: true });

        // التحقق من نجاح تسجيل الدخول
        const isLoggedIn = await page.evaluate(() => {
            return !document.body.innerText.includes('Invalid') && 
                   !document.body.innerText.includes('خطأ') &&
                   (document.querySelector('.x-menu-item-text') !== null ||
                    document.querySelector('.x-panel-header-title') !== null);
        });

        if (isLoggedIn) {
            console.log('تم تسجيل الدخول بنجاح');
            return { success: true, page, loginScreenshot, afterLoginScreenshot };
        } else {
            console.log('فشل تسجيل الدخول');
            return { 
                success: false, 
                error: 'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد.',
                loginScreenshot,
                afterLoginScreenshot
            };
        }

    } catch (error) {
        console.error('خطأ في عملية تسجيل الدخول:', error);
        const errorScreenshot = await page.screenshot({ fullPage: true });
        return {
            success: false,
            error: `فشل تسجيل الدخول: ${error.message}`,
            loginScreenshot,
            errorScreenshot
        };
    }
}
// تحديث جزء معالجة الرسائل لإرسال الصورة


// ... [Rest of the code remains the same] ...



async function updateCallerId(page, newCallerId) {
    try {
        console.log('بدء عملية تحديث معرف المتصل...');
        
        // تعيين timeout أطول للتنقل
        await page.setDefaultNavigationTimeout(60000);
        await page.setDefaultTimeout(60000);

        // الانتقال إلى الصفحة الرئيسية
        await page.goto('http://sip.vipcaller.net/mbilling/', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        console.log('تم الانتقال إلى الصفحة الرئيسية');

        // انتظار تحميل العناصر الأساسية
        await page.waitForFunction(() => {
            return document.readyState === 'complete' && 
                   !document.querySelector('.loading-indicator');
        }, { timeout: 60000 });
        console.log('تم تحميل الصفحة بالكامل');

        // انتظار ظهور وكليك على SIP Users
        await page.waitForSelector('text/SIP Users', { timeout: 60000 });
        
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const sipUsersElement = elements.find(el => 
                el.textContent?.trim() === 'SIP Users' && 
                (el.offsetWidth > 0 || el.getClientRects().length > 0)
            );
            if (sipUsersElement) {
                sipUsersElement.click();
                return true;
            }
            return false;
        });
        console.log('تم النقر على SIP Users');

        // انتظار تحميل الجدول وظهور البيانات
        await page.waitForFunction(() => {
            const table = document.querySelector('table');
            const rows = table ? table.querySelectorAll('tr') : [];
            return rows.length > 1; // نتأكد من وجود صفوف في الجدول
        }, { timeout: 60000 });

        // انتظار إضافي للتأكد من اكتمال تحميل البيانات
        await page.waitForTimeout(3000);

        // التقاط صورة بعد النقر على SIP Users
        const screenshotAfterSIPUsers = await page.screenshot({ 
            fullPage: true,
            encoding: 'base64'
        });

        // النقر على صف المستخدم
        const userClicked = await page.evaluate(() => {
            try {
                // البحث عن الجدول وصفوفه
                const table = document.querySelector('table');
                if (!table) return { success: false, error: 'لم يتم العثور على الجدول' };

                // البحث عن أول صف يحتوي على بيانات (تجاهل صف العناوين)
                const rows = Array.from(table.querySelectorAll('tr')).slice(1);
                if (rows.length === 0) return { success: false, error: 'لم يتم العثور على أي صفوف في الجدول' };

                // محاولة النقر على الصف الأول
                const firstRow = rows[0];
                
                // محاولة النقر على الرابط أو الخلية في الصف
                const clickableElement = firstRow.querySelector('a') || firstRow.querySelector('td') || firstRow;
                clickableElement.click();
                
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        if (!userClicked.success) {
            throw new Error(`فشل النقر على صف المستخدم: ${userClicked.error}`);
        }
        console.log('تم النقر على صف المستخدم');

        // انتظار ظهور حقل معرف المتصل
        await page.waitForSelector('input[name="callerid"]', { timeout: 60000 });

        // تحديث معرف المتصل
        await page.evaluate((newId) => {
            const input = document.querySelector('input[name="callerid"]');
            if (input) {
                input.value = newId;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, newCallerId);

        // البحث عن زر الحفظ والنقر عليه
        const saveClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            const saveButton = buttons.find(btn => 
                btn.textContent.toLowerCase().includes('save') || 
                btn.textContent.includes('حفظ')
            );
            if (saveButton) {
                saveButton.click();
                return true;
            }
            return false;
        });

        if (!saveClicked) {
            throw new Error('لم يتم العثور على زر الحفظ');
        }

        // انتظار اكتمال العملية
        await page.waitForFunction(() => {
            return document.body.innerText.includes('Success') ||
                   document.body.innerText.includes('نجاح') ||
                   !document.querySelector('.loading-indicator');
        }, { timeout: 60000 });

        console.log('تم تحديث معرف المتصل بنجاح');
        return { 
            success: true,
            screenshotAfterSIPUsers // إرجاع الصورة التي تم التقاطها بعد النقر على SIP Users
        };

    } catch (error) {
        console.error('خطأ في تحديث معرف المتصل:', error);
        const screenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });
        throw { 
            message: `فشل تحديث معرف المتصل: ${error.message}`, 
            screenshot: screenshot || error.screenshotAfterSIPUsers
        };
    }
}





process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});

