import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';

/**
 * دالة متقدمة لاستخراج جميع روابط m3u8 مع الـ Headers الخاصة بها
 */
async function extractM3u8WithBrowser(mainIframeUrl, browser) {
    const page = await browser.newPage();
    let foundStreams = []; // مصفوفة لحفظ جميع الروابط مع الترويسات

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // مراقبة الاستجابة
    page.on('response', (response) => {
        const url = response.url();
        // نبحث عن الرابط ونتأكد من نجاح الطلب
        if (url.includes('.m3u8') && !url.includes('/ad/') && response.status() === 200) {
            // نتحقق من عدم إضافة نفس الرابط مسبقاً لمنع التكرار
            const isDuplicate = foundStreams.find(stream => stream.url === url);
            if (!isDuplicate) {
                // استخراج الـ Request Headers
                const requestHeaders = response.request().headers();
                
                foundStreams.push({
                    url: url,
                    headers: requestHeaders
                });
                console.log(`[+] تم العثور على رابط جديد: ${url}`);
            }
        }
    });

    try {
        await page.goto(mainIframeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 1. جمع كل روابط السيرفرات الأساسية من .servers_list
        const mainServers = await page.$$eval('.servers_list a', elements => elements.map(a => a.href));
        
        for (let serverUrl of mainServers) {
            console.log(`-> جاري فحص السيرفر الفرعي: ${serverUrl}`);
            await page.goto(serverUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            // 2. البحث عن سيرفرات داخلية (مثل aplr-menu) والنقر عليها
            const subServers = await page.$$('.aplr-menu a[role="button"]');
            
            // نحاول النقر على السيرفرات الداخلية
            for (let subBtn of subServers) {
                await subBtn.click().catch(() => {});
                // النقر في المنتصف لتشغيل الفيديو (قد يحفز جلب m3u8 إضافية)
                await page.mouse.click(640, 360).catch(() => {}); 
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    } catch (e) {
        console.log(`⚠️ خطأ أثناء التصفح: ${e.message}`);
    } finally {
        await page.close();
    }
    
    return foundStreams; // إرجاع المصفوفة التي تحتوي على الروابط والـ Headers
}

// دالة getServerIframeUrl
async function getServerIframeUrl(pageUrl) {
    if (!pageUrl) return "";
    try {
        const { data } = await axios.get(pageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000 
        });
        const iframes = data.match(/<iframe[^>]+>/gi) || [];
        for (let iframe of iframes) {
            if (iframe.includes('id="main-player"') || iframe.includes('/tv/')) {
                const srcMatch = iframe.match(/src=["']([^"']+)["']/i);
                if (srcMatch) return srcMatch[1];
            }
        }
        return "";
    } catch (e) { return ""; }
}

// الدالة الرئيسية
async function scrapeMatches() {
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const { data } = await axios.get('https://liva7hd.info/wp-content/themes/jannah-1/MatchesPanel/api/matches.php?v=' + Date.now());
        const matchesData = data.matches || [];
        const formattedMatches = [];

        for (let i = 0; i < matchesData.length; i++) {
            const matchInfo = matchesData[i];
            const streamUrl = await getServerIframeUrl(matchInfo.meta?.link || "");
            let streamsData = []; // مصفوفة فارغة في حال لم يتم العثور على شيء
            
            if (streamUrl) {
                console.log(`\n🔍 معالجة مباراة: ${matchInfo.team1?.name} vs ${matchInfo.team2?.name}`);
                streamsData = await extractM3u8WithBrowser(streamUrl, browser);
            }

            formattedMatches.push({
                id: i + 1,
                team1: matchInfo.team1?.name || "",
                team1Logo: matchInfo.team1?.logo || "",
                team2: matchInfo.team2?.name || "",
                team2Logo: matchInfo.team2?.logo || "",
                time: "",
                status: matchInfo.meta?.status === "Live" ? "جارية الآن" : matchInfo.meta?.status || "",
                channel: matchInfo.meta?.channel || matchInfo.meta?.commentator || "",
                league: matchInfo.meta?.champ || "",
                iframeUrl: streamUrl,
                streams: streamsData // هنا سيتم حفظ مصفوفة الروابط مع الـ headers
            });
        }
        
        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
        console.log('\n✅ تم الانتهاء من فحص المباريات وحفظ البيانات في matches.json');
        
    } catch (error) {
        console.error('❌ خطأ:', error.message);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeMatches();
