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

// ... [Previous bot event handlers remain the same] ...

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
        // Set a longer default timeout
        page.setDefaultTimeout(300000); // 5 minutes
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to login page...');
        await page.goto('http://sip.vipcaller.net/mbilling/', {
            waitUntil: 'networkidle0',
            timeout: 300000
        });

        // Wait for any element from the login form to appear
        await page.waitForSelector('input[name="userid"], input[name="password"], .x-btn-inner-default-large', {
            timeout: 300000
        });

        // Add a small delay to ensure the page is fully loaded
        await page.waitForTimeout(3000);

        console.log('Entering credentials...');
        
        // Use evaluate to interact with the form directly
        await page.evaluate(async (user, pass) => {
            // Find the username input
            const useridInput = document.querySelector('input[name="userid"]');
            if (useridInput) {
                useridInput.value = user;
                // Trigger input event
                useridInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Find the password input
            const passwordInput = document.querySelector('input[name="password"]');
            if (passwordInput) {
                passwordInput.value = pass;
                // Trigger input event
                passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Find and click the login button
            const loginButtons = Array.from(document.querySelectorAll('.x-btn-inner'));
            const loginButton = loginButtons.find(btn => 
                btn.textContent.toLowerCase().includes('login') || 
                btn.textContent.includes('تسجيل الدخول')
            );
            
            if (loginButton) {
                loginButton.click();
            }
        }, username, password);

        // Wait for navigation or error
        try {
            await Promise.race([
                page.waitForNavigation({ timeout: 30000 }),
                page.waitForSelector('.error-message', { timeout: 30000 })
            ]);
        } catch (e) {
            console.log('Navigation timeout or no error message found');
        }

        // Take screenshot after login attempt
        await page.screenshot({ path: 'after-login.png' });

        // Check if login was successful
        const loginSuccess = await page.evaluate(() => {
            // Check various success indicators
            const url = window.location.href;
            const body = document.body.innerText;
            
            return url.includes('dashboard') ||
                   url.includes('index.php?r=') ||
                   body.includes('welcome') ||
                   body.includes('الصفحة الرئيسية') ||
                   body.includes('لوحة التحكم');
        });

        if (loginSuccess) {
            console.log('Login successful');
            return { success: true, page };
        } else {
            console.log('Login failed');
            // Check for specific error messages
            const errorMessage = await page.evaluate(() => {
                const errorElement = document.querySelector('.error-message');
                return errorElement ? errorElement.textContent : 'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد.';
            });
            return { success: false, error: errorMessage };
        }
    } catch (error) {
        console.error('Error in login process:', error);
        await page.screenshot({ path: 'login-error.png' });
        // Close the page to free up resources
        await page.close();
        throw new Error(`حدث خطأ أثناء تسجيل الدخول: ${error.message}`);
    }
}

async function performLoginWithRetry(username, password, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`محاولة تسجيل الدخول ${i + 1} من ${maxRetries}`);
            const result = await performLogin(username, password);
            if (result.success) {
                return result;
            }
            lastError = result.error;
        } catch (error) {
            console.error(`فشلت محاولة تسجيل الدخول ${i + 1}:`, error);
            lastError = error.message;
            if (i === maxRetries - 1) {
                throw new Error(lastError);
            }
            // Wait longer between retries
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
        }
    }
    return { success: false, error: lastError };
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