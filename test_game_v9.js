import { chromium } from 'playwright';

async function validateReturnToTitle() {
  console.log('Starting return to title E2E validation...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
  page.on('pageerror', err => console.error(`[BROWSER EXCEPTION] ${err}`));

  try {
    await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });

    // --- TEST 1: HUD TITLE BUTTON ---
    console.log('TEST 1: Starting 3D mode and returning to title from HUD...');
    await page.click('#btn-start-3d');
    await page.waitForTimeout(1000); // Wait for transition

    // Click TITLE button on HUD
    console.log('Clicking HUD TITLE button...');
    await page.click('#btn-hud-title');
    await page.waitForTimeout(800);

    const menuActive = await page.evaluate(() => {
      const titleActive = document.getElementById('title-screen').classList.contains('active');
      const hudActive = document.getElementById('hud').classList.contains('active');
      const gameDebug = window.gameDebug;
      return {
        titleActive,
        hudActive,
        playerRemoved: gameDebug.playerGroup === null
      };
    });

    console.log('Menu active status (Test 1):', menuActive);
    if (menuActive.titleActive && !menuActive.hudActive && menuActive.playerRemoved) {
      console.log('✅ PASS: Successfully returned to title screen from HUD.');
    } else {
      console.error('❌ FAIL: Return to title from HUD status check failed.');
    }
    await page.screenshot({ path: 'to_title_from_hud.png' });

    // --- TEST 2: GAMEOVER TITLE BUTTON ---
    console.log('TEST 2: Launching 2D, waiting for damage to trigger gameover, then returning...');
    await page.click('#btn-start-2d');
    
    // Cheat or wait for gameover: let's programmatically trigger a shield hit to force gameover instantly
    await page.evaluate(() => {
      // Direct call to damagePlayer to trigger gameover
      window.damagePlayer(200);
    });
    await page.waitForTimeout(1000); // Settle on Game Over screen

    const isGameOver = await page.evaluate(() => {
      return document.getElementById('gameover-screen').classList.contains('active');
    });
    console.log('Game over screen active:', isGameOver);

    console.log('Clicking RETURN TO TITLE button...');
    await page.click('#btn-gameover-title');
    await page.waitForTimeout(800);

    const menuActive2 = await page.evaluate(() => {
      const titleActive = document.getElementById('title-screen').classList.contains('active');
      const gameoverActive = document.getElementById('gameover-screen').classList.contains('active');
      return { titleActive, gameoverActive };
    });

    console.log('Menu active status (Test 2):', menuActive2);
    if (menuActive2.titleActive && !menuActive2.gameoverActive) {
      console.log('✅ PASS: Successfully returned to title screen from Game Over overlay.');
    } else {
      console.error('❌ FAIL: Return to title from Game Over status check failed.');
    }
    await page.screenshot({ path: 'to_title_from_gameover.png' });

  } catch (err) {
    console.error('Validation error:', err);
  } finally {
    await browser.close();
    console.log('E2E validation finished.');
  }
}

validateReturnToTitle();
