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
        
        // إرسال صورة الصفحة الأولى
        if (updateResult.firstPageScreenshot) {
            await bot.sendPhoto(chatId, Buffer.from(updateResult.firstPageScreenshot, 'base64'), 
                { caption: 'صفحة SIP Users' });
        }
        
        // إرسال صورة صفحة التحرير
        if (updateResult.editPageScreenshot) {
            await bot.sendPhoto(chatId, Buffer.from(updateResult.editPageScreenshot, 'base64'), 
                { caption: 'صفحة تحرير معرف المتصل' });
        }
        
        if (updateResult.success) {
            bot.editMessageText('✅ تم تغيير معرف المتصل بنجاح!', {
                chat_id: chatId,
                message_id: updateMessage.message_id
            });
        } else {
            throw new Error('فشل تحديث معرف المتصل');
        }
    } catch (error) {
        console.error('خطأ في تغيير معرف المتصل:', error);
        bot.editMessageText(`❌ فشل تغيير معرف المتصل. ${error.message}`, {
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
            timeout: 10000
        });

        // التقاط صورة لصفحة تسجيل الدخول
        const loginScreenshot = await page.screenshot({ fullPage: true });

        // انتظار ظهور حقول الإدخال
        await page.waitForSelector('input[name="userid"]', { visible: true, timeout: 10000 });
        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 10000 });
        
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
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => console.log('تم انتهاء مهلة الانتظار للتنقل'))
        ]);

        // انتظار لحظة إضافية للتأكد من اكتمال تحميل الصفحة
        await page.waitForTimeout(500);

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
        
        // التأكد من أننا في الصفحة الرئيسية
        await page.goto('http://sip.vipcaller.net/mbilling/', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        
        // انتظار لتحميل الصفحة
        await page.waitForTimeout(3000);
        
        // محاولة النقر على SIP Users باستخدام عدة طرق
        const sipUsersClicked = await page.evaluate(() => {
            // طريقة 1: البحث عن الروابط
            const links = Array.from(document.querySelectorAll('a'));
            const sipLink = links.find(link => link.textContent.includes('SIP Users'));
            if (sipLink) {
                sipLink.click();
                return true;
            }

            // طريقة 2: البحث في عناصر القائمة
            const menuItems = Array.from(document.querySelectorAll('.x-menu-item-text, .x-tree-node-text'));
            const sipMenuItem = menuItems.find(item => item.textContent.includes('SIP Users'));
            if (sipMenuItem) {
                sipMenuItem.click();
                return true;
            }

            // طريقة 3: البحث في جميع العناصر القابلة للنقر
            const allClickable = Array.from(document.querySelectorAll('*')).filter(el => 
                el.textContent.includes('SIP Users') && 
                (el.onclick || el.className.includes('clickable') || el.className.includes('menu') || el.role === 'button')
            );
            if (allClickable.length > 0) {
                allClickable[0].click();
                return true;
            }

            return false;
        });

        if (!sipUsersClicked) {
            // محاولة أخيرة باستخدام userEvent
            try {
                await page.waitForSelector('text/SIP Users', { timeout: 5000 });
                await page.click('text/SIP Users');
                console.log('تم النقر على SIP Users باستخدام text selector');
            } catch (err) {
                throw new Error('لم يتم العثور على رابط SIP Users. يرجى التأكد من تسجيل الدخول بشكل صحيح.');
            }
        }

        // انتظار لتحميل الجدول
        await page.waitForTimeout(3000);

        // التقاط صورة للصفحة الأولى
        const firstPageScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // البحث عن الصف في الجدول والنقر عليه
        const rowClicked = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('tr')).filter(row => 
                row.textContent.includes('VIP') || 
                row.textContent.includes('dynamic') ||
                row.textContent.includes('57658')
            );
            if (rows.length > 0) {
                rows[0].click();
                return true;
            }
            return false;
        });

        if (!rowClicked) {
            throw new Error('لم يتم العثور على صف المستخدم في الجدول');
        }

        await page.waitForTimeout(3000);

        // محاولة العثور على حقل معرف المتصل
        const callerIdField = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const callerIdInput = inputs.find(input => 
                input.name === 'callerid' || 
                input.id?.includes('caller') ||
                input.placeholder?.includes('Caller') ||
                input.value?.includes('+') // عادة ما يكون معرف المتصل يبدأ بـ +
            );
            if (callerIdInput) {
                callerIdInput.value = '';  // مسح القيمة القديمة
                return true;
            }
            return false;
        });

        if (!callerIdField) {
            throw new Error('لم يتم العثور على حقل معرف المتصل');
        }

        // إدخال معرف المتصل الجديد
        await page.type('input[name="callerid"]', newCallerId);
        
        // التقاط صورة لصفحة التحرير
        const editPageScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // البحث عن زر الحفظ والنقر عليه
        const saveClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            const saveButton = buttons.find(btn => 
                btn.textContent?.toLowerCase().includes('save') || 
                btn.value?.toLowerCase().includes('save') ||
                btn.innerHTML?.toLowerCase().includes('save')
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

        await page.waitForTimeout(3000);

        return {
            success: true,
            firstPageScreenshot,
            editPageScreenshot,
            message: 'تم تحديث معرف المتصل بنجاح'
        };

    } catch (error) {
        console.error('خطأ في تحديث معرف المتصل:', error);
        const errorScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });
        throw {
            message: `فشل تحديث معرف المتصل: ${error.message}`,
            screenshot: errorScreenshot
        };
    }
}



process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});

