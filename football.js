import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';

/**
 * دالة متقدمة لاستخراج الـ m3u8 من خلال التنقل في السيرفرات المتعددة
 */
async function extractM3u8WithBrowser(mainIframeUrl, browser) {
    const page = await browser.newPage();
    let validM3u8 = "";

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // مراقبة الاستجابة (نفس المنطق السابق)
    page.on('response', (response) => {
        const url = response.url();
        if (url.includes('.m3u8') && !url.includes('/ad/') && !validM3u8 && response.status() === 200) {
            validM3u8 = url;
            console.log(`[+] تم العثور على رابط فعال: ${url}`);
        }
    });

    try {
        await page.goto(mainIframeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 1. جمع كل روابط السيرفرات الأساسية من .servers_list
        const mainServers = await page.$$eval('.servers_list a', elements => elements.map(a => a.href));
        
        for (let serverUrl of mainServers) {
            if (validM3u8) break;
            
            console.log(`-> جاري فحص السيرفر الفرعي: ${serverUrl}`);
            await page.goto(serverUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 2000));

            // 2. البحث عن سيرفرات داخلية (مثل aplr-menu) والنقر عليها
            const subServers = await page.$$('.aplr-menu a[role="button"]');
            
            // نحاول النقر على السيرفرات الداخلية
            for (let subBtn of subServers) {
                if (validM3u8) break;
                
                await subBtn.click().catch(() => {});
                // النقر في المنتصف لتشغيل الفيديو
                await page.mouse.click(640, 360); 
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    } catch (e) {
        console.log(`⚠️ خطأ أثناء التصفح: ${e.message}`);
    } finally {
        await page.close();
    }
    return validM3u8;
}

// ... باقي الدوال (getServerIframeUrl و scrapeMatches) تبقى كما هي ...

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
            let directStream = "";
            
            if (streamUrl) {
                console.log(`🔍 معالجة: ${matchInfo.team1?.name} vs ${matchInfo.team2?.name}`);
                directStream = await extractM3u8WithBrowser(streamUrl, browser);
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
                streamUrl: streamUrl,
                stream: directStream
            });
        }
        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
    } catch (error) {
        console.error('❌ خطأ:', error.message);
    } finally {
        if (browser) await browser.close();
    }
}

// دالة getServerIframeUrl المعتادة
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

scrapeMatches();
