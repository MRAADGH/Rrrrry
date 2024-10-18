const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const token = '6845291404:AAFwsPGqdbSOjx19EVXjjh4EnUQD1v1vJlc'; // استبدل بـ Token البوت الخاص بك
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

// فتح متصفح
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

// استقبال الأوامر من البوت
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
                    if (loginResult.success) {
                        userStates.set(chatId, STATES.WAITING_CALLER_ID);
                        session.page = loginResult.page;
                        userSessions.set(chatId, session);
                        bot.editMessageText('✅ تم تسجيل الدخول بنجاح!\nالرجاء إدخال معرف المتصل الجديد:', {
                            chat_id: chatId,
                            message_id: statusMessage.message_id
                        });
                    } else {
                        userStates.set(chatId, STATES.IDLE);
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
        console.log('Navigating to login page...');
        await page.goto('http://sip.vipcaller.net/mbilling/', {
            waitUntil: 'networkidle0',
            timeout: 180000 // زيادة المهلة إلى 3 دقائق
        });

        console.log('Waiting for login form...');
        await page.waitForSelector('input[name="userid"]', { visible: true, timeout: 180000 });
        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 180000 });

        console.log('Entering login credentials...');
        await page.type('input[name="userid"]', username, { delay: 100 });
        await page.type('input[name="password"]', password, { delay: 100 });

        console.log('Submitting login form...');
        await Promise.all([
            page.click('#button-1015'), // الضغط على الزر بواسطة المعرف
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 180000 })
        ]);

        // تحقق من أن الصفحة بعد تسجيل الدخول تحتوي على عنصر يدل على نجاح تسجيل الدخول
        const pageContent = await page.content();
        if (pageContent.includes('VIP57658') || pageContent.includes('Clients')) {
            console.log('Login successful');
            return { success: true, page };
        } else {
            console.log('Login failed');
            return { success: false, error: 'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد.' };
        }
    } catch (error) {
        console.error('Error in login process:', error);
        await page.screenshot({ path: 'login-error.png', fullPage: true });
        throw new Error(`فشل تسجيل الدخول: ${error.message}`);
    }
}


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
