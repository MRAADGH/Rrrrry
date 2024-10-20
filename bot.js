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
            // Send all captured screenshots
            const sendScreenshot = async (screenshot, caption) => {
                if (screenshot) {
                    try {
                        const buffer = Buffer.from(screenshot, 'base64');
                        await bot.sendPhoto(chatId, buffer, { caption });
                    } catch (error) {
                        console.error(`Error sending ${caption}:`, error);
                    }
                }
            };

            await Promise.all([
                sendScreenshot(updateResult.homeScreenshot, 'الصفحة الرئيسية'),
                sendScreenshot(updateResult.sipUsersScreenshot, 'صفحة SIP Users'),
                sendScreenshot(updateResult.optionsPageScreenshot, 'صفحة الخيارات'),
                sendScreenshot(updateResult.editUserScreenshot, 'صفحة تحرير المستخدم'),
                sendScreenshot(updateResult.afterSaveScreenshot, 'بعد محاولة الحفظ')
            ]);

            await bot.editMessageText(`✅ تم تغيير معرف المتصل بنجاح إلى: ${updateResult.actualCallerId}`, {
                chat_id: chatId,
                message_id: updateMessage.message_id
            });
        } else {
            throw new Error('فشل تحديث معرف المتصل');
        }
    } catch (error) {
        console.error('خطأ في تغيير معرف المتصل:', error);
        
        // Send error screenshots
        const sendErrorScreenshot = async (screenshot, caption) => {
            if (screenshot) {
                try {
                    const buffer = Buffer.from(screenshot, 'base64');
                    await bot.sendPhoto(chatId, buffer, { caption });
                } catch (err) {
                    console.error(`Error sending error screenshot ${caption}:`, err);
                }
            }
        };

        await Promise.all([
            sendErrorScreenshot(error.homeScreenshot, 'الصفحة الرئيسية'),
            sendErrorScreenshot(error.sipUsersScreenshot, 'صفحة SIP Users'),
            sendErrorScreenshot(error.optionsPageScreenshot, 'صفحة الخيارات'),
            sendErrorScreenshot(error.editUserScreenshot, 'صفحة تحرير المستخدم'),
            sendErrorScreenshot(error.afterSaveScreenshot, 'بعد محاولة الحفظ'),
            sendErrorScreenshot(error.errorScreenshot, 'صورة الخطأ')
        ]);

        bot.editMessageText(`❌ فشل تغيير معرف المتصل. ${error.message}\nيرجى مراجعة الصور المرسلة للتفاصيل.`, {
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





async function updateCallerId(page, newCallerId) {
    let screenshots = {};
    try {
        console.log('بدء عملية تحديث معرف المتصل...');
        
        // التنقل إلى الصفحة الرئيسية
        await page.goto('http://sip.vipcaller.net/mbilling/', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        console.log('تم الانتقال إلى الصفحة الرئيسية');

        // التقاط صورة للصفحة الرئيسية
        screenshots.homeScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // البحث والنقر على "SIP Users"
        const sipUsersFound = await page.evaluate(() => {
            const sipUsersLink = Array.from(document.querySelectorAll('.x-tree-node-anchor, a, span, td'))
                .find(el => el.textContent.includes('SIP Users'));
            if (sipUsersLink) {
                sipUsersLink.click();
                return true;
            }
            return false;
        });

        if (!sipUsersFound) {
            throw new Error('لم يتم العثور على رابط SIP Users');
        }

        console.log('تم العثور على SIP Users والنقر عليه');

        // انتظار تحميل الجدول
        await page.waitForSelector('table', { timeout: 30000 });

        // التقاط صورة لصفحة SIP Users
        screenshots.sipUsersScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // البحث عن الصف الذي يحتوي على "g729,gsm,alaw,ulaw" والنقر عليه
        const userClicked = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tr'));
            const targetRow = rows.find(row => row.textContent.includes('g729,gsm,alaw,ulaw'));
            if (targetRow) {
                targetRow.click();
                return true;
            }
            return false;
        });

        if (!userClicked) {
            throw new Error('لم يتم العثور على الصف المطلوب أو النقر عليه');
        }

        console.log('تم النقر على الصف المحتوي على g729,gsm,alaw,ulaw');

        // انتظار ظهور الخيارات
        await page.waitForTimeout(5000);

        // التقاط صورة للصفحة الحالية (صفحة الخيارات)
        screenshots.optionsPageScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // البحث عن زر التحرير والنقر عليه
        const editClicked = await page.evaluate(() => {
            const editButtons = Array.from(document.querySelectorAll('span, div, a, button, input[type="button"]'))
                .filter(el => el.textContent.includes('Edit') || 
                              el.textContent.includes('تعديل') ||
                              el.textContent.includes('تحرير') ||
                              el.value?.includes('Edit') ||
                              el.value?.includes('تعديل') ||
                              el.value?.includes('تحرير'));
            
            console.log('الأزرار المحتملة للتحرير:', editButtons.map(b => b.outerHTML));
            
            if (editButtons.length > 0) {
                editButtons[0].click();
                return true;
            }
            return false;
        });

        if (!editClicked) {
            console.log('لم يتم العثور على زر التحرير. محاولة النقر على أي زر متاح...');
            const anyButtonClicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="button"], .x-btn'));
                console.log('جميع الأزرار المتاحة:', buttons.map(b => b.outerHTML));
                if (buttons.length > 0) {
                    buttons[0].click();
                    return true;
                }
                return false;
            });
            if (!anyButtonClicked) {
                throw new Error('لم يتم العثور على أي أزرار للنقر عليها');
            }
        }

        console.log('تم النقر على زر التحرير أو أحد الأزرار المتاحة');

        // انتظار تحميل نموذج التحرير
        await page.waitForTimeout(5000);

        // التقاط صورة لصفحة تحرير المستخدم
        screenshots.editUserScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // البحث عن حقل معرف المتصل
        const callerIdFieldFound = await page.evaluate(() => {
            const field = document.querySelector('input[name="callerid"]');
            console.log('حقل معرف المتصل:', field ? field.outerHTML : 'غير موجود');
            return !!field;
        });

        if (!callerIdFieldFound) {
            throw new Error('لم يتم العثور على حقل معرف المتصل');
        }

        // تحديث قيمة معرف المتصل
        await page.evaluate((newCallerId) => {
            const callerIdField = document.querySelector('input[name="callerid"]');
            if (callerIdField) callerIdField.value = newCallerId;
        }, newCallerId);

        console.log('تم إدخال معرف المتصل الجديد');

        // البحث والنقر على زر الحفظ
        const saveButtonClicked = await page.evaluate(() => {
            const saveButtons = Array.from(document.querySelectorAll('button, input[type="submit"], .x-btn'))
                .filter(btn => 
                    btn.textContent.toLowerCase().includes('save') || 
                    btn.textContent.includes('حفظ') ||
                    btn.value?.toLowerCase().includes('save') ||
                    btn.value?.includes('حفظ')
                );
            
            console.log('أزرار الحفظ المحتملة:', saveButtons.map(b => b.outerHTML));
            
            if (saveButtons.length > 0) {
                saveButtons[0].click();
                return true;
            }
            return false;
        });

        if (!saveButtonClicked) {
            throw new Error('لم يتم العثور على زر الحفظ');
        }

        console.log('تم النقر على زر الحفظ');

        // انتظار لفترة قصيرة
        await page.waitForTimeout(5000);

        // التقاط صورة بعد الحفظ
        screenshots.afterSaveScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });

        // التحقق من قيمة معرف المتصل الفعلية
        const actualCallerId = await page.evaluate(() => {
            const callerIdField = document.querySelector('input[name="callerid"]');
            return callerIdField ? callerIdField.value : null;
        });

        if (actualCallerId !== newCallerId) {
            throw new Error(`لم يتم تحديث معرف المتصل. القيمة الحالية: ${actualCallerId}`);
        }

        console.log('تم تحديث معرف المتصل بنجاح');

        return { 
            success: true, 
            ...screenshots,
            actualCallerId 
        };
    } catch (error) {
        console.error('خطأ في تحديث معرف المتصل:', error);
        screenshots.errorScreenshot = await page.screenshot({ fullPage: true, encoding: 'base64' });
        throw { 
            message: `فشل تحديث معرف المتصل: ${error.message}`, 
            ...screenshots
        };
    }
}




process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});
