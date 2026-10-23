const {chromium}=require('C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:780,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///F:/code/lightning/tmp/video-analysis/cps-preview.html');
 const frame=page.frameLocator('iframe');
 await frame.locator('[data-key="users"]').fill('1000');
 console.log('Changed to 1000 users:',await frame.locator('[data-out="cash"]').innerText(),await frame.locator('[data-out="economic"]').innerText());
 await frame.locator('[data-key="unit"]').fill('0');
 console.log('Zero unit contribution:',await frame.locator('[data-out="needed"]').innerText());
 await frame.locator('[data-key="unit"]').fill('0.8');
 await frame.locator('[data-key="users"]').fill('500');
 await page.screenshot({path:'F:/code/lightning/tmp/video-analysis/cps-preview.png',fullPage:true});
 await page.setViewportSize({width:360,height:1100});
 await page.screenshot({path:'F:/code/lightning/tmp/video-analysis/cps-mobile.png',fullPage:true});
 console.log('errors',errors);
 const f=page.frames()[1];console.log('widths',await f.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})));
 await browser.close();
})();

