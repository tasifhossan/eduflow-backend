const path = require('path');
const fs = require('fs');

function loadCDPClient() {
  const possiblePaths = [
    path.resolve(__dirname, '../../scripts/qa/cdp-client.js'),
    path.resolve(__dirname, '../scripts/qa/cdp-client.js'),
    path.resolve(__dirname, './qa/cdp-client.js'),
    path.resolve(process.cwd(), 'scripts/qa/cdp-client.js'),
    path.resolve(process.cwd(), '../scripts/qa/cdp-client.js'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error('Could not find cdp-client.js in any known QA directory');
}

const CDPClient = loadCDPClient();

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'owner@example.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'SuperSecret123!';
const BASE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

const ROUTES = [
  '/dashboard',
  '/users',
  '/settings',
  '/fees/dues',
  '/admissions',
  '/lectures',
  '/report-cards',
];

const VIEWPORTS = [
  { name: '1280px (Desktop)', width: 1280, height: 800, mobile: false },
  { name: '375px (Mobile)', width: 375, height: 667, mobile: true },
];

async function runSpotCheck() {
  console.log('========================================================================');
  console.log('         Production Browser Spot Check via Existing CDP Client          ');
  console.log('========================================================================\n');

  const cdp = new CDPClient();
  const results = [];

  try {
    await cdp.start();
    console.log('[OK] Chrome launched in headless mode via CDPClient.');

    // 1. Navigate to /login
    console.log('\n--- Navigating to /login ---');
    await cdp.setViewport(1280, 800, false);
    await cdp.navigate(`${BASE_URL}/login`, 3000);

    const loginInputs = await cdp.evaluate(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const buttons = Array.from(document.querySelectorAll('button'));
        return {
          inputs: inputs.map(i => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder })),
          buttons: buttons.map(b => ({ text: b.innerText, type: b.type }))
        };
      })()
    `);
    console.log('Login form detected:', JSON.stringify(loginInputs));

    // Fill in credentials using React input setter
    console.log(`Filling credentials for ${OWNER_EMAIL} (no demo login)...`);
    await cdp.evaluate(`
      (() => {
        const setReactValue = (el, val) => {
          const proto = Object.getPrototypeOf(el);
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(el, val);
          } else {
            el.value = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const emailInput = document.querySelector('#identifier') || document.querySelector('input[name="identifier"]');
        const passInput = document.querySelector('#password') || document.querySelector('input[name="password"]');
        if (!emailInput) throw new Error('Email input not found on login page');
        if (!passInput) throw new Error('Password input not found on login page');

        emailInput.focus();
        setReactValue(emailInput, ${JSON.stringify(OWNER_EMAIL)});

        passInput.focus();
        setReactValue(passInput, ${JSON.stringify(OWNER_PASSWORD)});
      })()
    `);

    // Click submit button (not demo button)
    console.log('Submitting login form...');
    await cdp.evaluate(`
      (() => {
        const submitBtn = document.querySelector('button[type="submit"]') ||
          Array.from(document.querySelectorAll('button')).find(b => {
            const txt = b.innerText.toLowerCase();
            return (txt.includes('sign in') || txt.includes('log in') || txt.includes('login')) && !txt.includes('demo');
          });
        if (!submitBtn) throw new Error('Sign in submit button not found');
        submitBtn.click();
      })()
    `);

    // Wait for redirect to /dashboard
    console.log('Waiting for authentication redirect...');
    await new Promise(r => setTimeout(r, 4000));
    const currentUrl = await cdp.evaluate('window.location.href');
    console.log('Current URL after login:', currentUrl);

    if (currentUrl.includes('/login')) {
      const pageError = await cdp.evaluate(`
        (() => {
          const errEl = document.querySelector('[role="alert"], .text-red-500, .error-message');
          return errEl ? errEl.innerText : document.body.innerText.slice(0, 300);
        })()
      `);
      throw new Error(`Login failed to redirect away from /login. Page message: ${pageError}`);
    }

    // Now test all routes at both viewports
    for (const vp of VIEWPORTS) {
      console.log(`\n========================================================================`);
      console.log(`Testing Viewport: ${vp.name} (${vp.width}x${vp.height})`);
      console.log(`========================================================================`);

      await cdp.setViewport(vp.width, vp.height, vp.mobile);

      for (const route of ROUTES) {
        const targetUrl = `${BASE_URL}${route}`;
        cdp.clearLogs();
        await cdp.navigate(targetUrl, 3000);

        // Analyze page
        const analysis = await cdp.evaluate(`
          (() => {
            const text = document.body ? document.body.innerText : '';
            const hasDevShortcuts = text.includes('Developer shortcuts') ||
              text.includes('Dev Shortcuts') ||
              text.includes('Developer Shortcuts');
            const heading = document.querySelector('h1, h2')?.innerText || '';
            const title = document.title;
            return {
              hasDevShortcuts,
              heading,
              title,
              textSnippet: text.slice(0, 150).replace(/\\s+/g, ' ')
            };
          })()
        `);

        // Filter network errors - ignore favicon / optional icons
        const relevantNetworkErrors = cdp.networkErrors.filter(e => !e.includes('favicon.ico'));
        const relevantConsoleErrors = cdp.pageErrors;

        const record = {
          viewport: vp.name,
          route,
          devShortcutsPresent: analysis.hasDevShortcuts,
          consoleErrorsCount: relevantConsoleErrors.length,
          consoleErrors: relevantConsoleErrors,
          networkErrorsCount: relevantNetworkErrors.length,
          networkErrors: relevantNetworkErrors,
          heading: analysis.heading,
        };

        results.push(record);

        const statusTag = (!analysis.hasDevShortcuts && relevantConsoleErrors.length === 0 && relevantNetworkErrors.length === 0)
          ? '[PASS]'
          : '[WARN]';

        console.log(`${statusTag} ${route.padEnd(16)} | DevShortcuts: ${analysis.hasDevShortcuts ? 'FOUND' : 'None'} | ConsoleErrors: ${relevantConsoleErrors.length} | NetErrors: ${relevantNetworkErrors.length} | Heading: "${analysis.heading.slice(0, 30)}"`);
        if (relevantConsoleErrors.length > 0) {
          console.log(`    Console Errors:`, relevantConsoleErrors);
        }
        if (relevantNetworkErrors.length > 0) {
          console.log(`    Network Errors:`, relevantNetworkErrors);
        }
      }
    }

    console.log('\n========================================================================');
    console.log('                     SPOT CHECK SUMMARY TABLE                           ');
    console.log('========================================================================');
    console.table(results.map(r => ({
      Viewport: r.viewport.split(' ')[0],
      Route: r.route,
      'Dev Shortcuts': r.devShortcutsPresent ? 'DETECTED' : 'Clean',
      'Console Errors': r.consoleErrorsCount,
      'Net Errors': r.networkErrorsCount,
      Heading: r.heading.slice(0, 25),
    })));

  } catch (err) {
    console.error('[FATAL] Spot check failed with exception:', err);
    process.exitCode = 1;
  } finally {
    await cdp.close();
    console.log('[OK] Browser closed.');
  }
}

if (require.main === module) {
  runSpotCheck();
}

module.exports = runSpotCheck;
