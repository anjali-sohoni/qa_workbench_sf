import { test, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

let browser: Browser;
let commCtx: BrowserContext, commPage: Page;
let salesCtx: BrowserContext, salesPage: Page;
let lightningOrigin: string;
let sfSessionId: string;
let sfInstanceUrl: string;

test.beforeAll({ timeout: 120_000 }, async () => {
  browser = await chromium.launch({ headless: !!process.env.CI });

  const videoDir = 'test-results/videos';
  const ctxOptions = { recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } };

  commCtx  = await browser.newContext(ctxOptions);
  commPage = await commCtx.newPage();
  await commPage.goto(process.env.SF_COMM_URL + '/s/login');
  await commPage.fill('input[placeholder="Username"]', process.env.SF_COMM_USERNAME);
  await commPage.fill('input[type="password"]', process.env.SF_COMM_EFFECTIVE_PW);
  await commPage.click('button.loginButton');
  await commPage.waitForURL(url => url.toString().includes('/s/') && !url.toString().includes('/s/login'), { timeout: 60000 });

  salesCtx  = await browser.newContext(ctxOptions);
  salesPage = await salesCtx.newPage();

  const soapLoginBody = [
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    '  xmlns:urn="urn:partner.soap.sforce.com">',
    '  <soapenv:Body><urn:login>',
    `    <urn:username>${process.env.SF_SALES_USERNAME}</urn:username>`,
    `    <urn:password>${process.env.SF_SALES_EFFECTIVE_PW}</urn:password>`,
    '  </urn:login></soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('');
  const soapResp = await fetch('https://login.salesforce.com/services/Soap/u/57.0', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', 'SOAPAction': 'login' },
    body: soapLoginBody,
  });
  const soapXml = await soapResp.text();
  sfSessionId      = soapXml.match(/<sessionId>(.*?)<\/sessionId>/)?.[1] ?? '';
  const serverUrl  = soapXml.match(/<serverUrl>(.*?)<\/serverUrl>/)?.[1];
  if (!sfSessionId) throw new Error(`[beforeAll] SF SOAP login failed: ${soapXml.substring(0, 400)}`);
  sfInstanceUrl = new URL(serverUrl!).origin;
  console.log('[beforeAll] SF SOAP login succeeded — instance:', sfInstanceUrl);

  await salesPage.goto(`${sfInstanceUrl}/secur/frontdoor.jsp?sid=${sfSessionId}&retURL=/lightning/page/home`);
  await salesPage.waitForURL(url => !url.toString().includes('frontdoor'), { timeout: 60000, waitUntil: 'commit' });
  await salesPage.waitForLoadState('domcontentloaded');
  lightningOrigin = new URL(salesPage.url()).origin;
  console.log('[beforeAll] salesPage Lightning origin:', lightningOrigin, '| url:', salesPage.url());
});

test.afterAll(async ({}, testInfo) => {
  const commVideo = commPage?.video();
  const salesVideo = salesPage?.video();

  await commCtx?.close();
  await salesCtx?.close();
  await browser?.close();

  const commPath = await commVideo?.path();
  const salesPath = await salesVideo?.path();
  if (commPath) await testInfo.attach('community-session', { path: commPath, contentType: 'video/webm' });
  if (salesPath) await testInfo.attach('sales-session',   { path: salesPath, contentType: 'video/webm' });
});

test('TC-0002-02: Store Application Number in Name field and verify sequential increment', async () => {
  const testData = [
    {
      "Academic_Dept__c": "Science",
      "GPA__c": 3.85,
      "School_Name__c": "Acme Corporation",
      "Email__c": "synthetic.user.001@example.com",
      "Applicant_Name__c": "Meredith Grey",
      "FAFSA__c": true,
      "Application_Type__c": "Graduate",
      "DOB__c": "03/22/1985",
      "TestScore__c": 1520
    },
    {
      "GPA__c": 2.45,
      "Applicant_Name__c": "Meredith Grey",
      "School_Name__c": "Global Industries",
      "Email__c": "synthetic.user.002@example.com",
      "TestScore__c": 950,
      "Application_Type__c": "Under Graduate",
      "Academic_Dept__c": "Business",
      "FAFSA__c": false,
      "DOB__c": "11/08/1992"
    },
    {
      "DOB__c": "07/14/1988",
      "Applicant_Name__c": "Meredith Grey",
      "Application_Type__c": "Graduate",
      "TestScore__c": 1580,
      "School_Name__c": "Tech Solutions Ltd",
      "Email__c": "synthetic.user.003@example.com",
      "FAFSA__c": true,
      "Academic_Dept__c": "Math",
      "GPA__c": 3.92
    }
  ];

  const capturedAppNumbers: string[] = [];

  for (let i = 0; i < testData.length; i++) {
    const data = testData[i];
    console.log(`[test] Submitting application ${i + 1} of ${testData.length}`);

    await commPage.goto(process.env.SF_COMM_URL + '/s/application/Application__c/Default');
    await commPage.waitForLoadState('domcontentloaded');
    await commPage.waitForTimeout(2000);

    const newButton = commPage.getByRole('button', { name: 'New' });
    await newButton.waitFor({ state: 'visible', timeout: 15000 });
    await newButton.click();

    await commPage.locator('button[name="SaveEdit"]').waitFor({ state: 'visible', timeout: 20000 });
    await commPage.waitForTimeout(3000);

    await commPage.locator('input[name="Email__c"]').fill(data.Email__c);
    await commPage.locator('input[name="DOB__c"]').fill(data.DOB__c);
    await commPage.locator('input[name="School_Name__c"]').fill(data.School_Name__c);
    await commPage.locator('input[name="GPA__c"]').fill(data.GPA__c.toString());
    await commPage.locator('input[name="TestScore__c"]').fill(data.TestScore__c.toString());

    await commPage.locator('button[aria-label="Application Type"]').click({ force: true });
    await commPage.waitForTimeout(500);
    await commPage.locator(`[data-value="${data.Application_Type__c}"]`).click();

    await commPage.locator('button[aria-label="Academic Dept"]').click({ force: true });
    await commPage.waitForTimeout(500);
    await commPage.locator(`[data-value="${data.Academic_Dept__c}"]`).click();

    if (data.FAFSA__c) {
      await commPage.locator('input[name="FAFSA__c"]').check();
    }

    const submitBtn = commPage.locator('button[name="SaveEdit"]');
    await submitBtn.waitFor({ state: 'visible', timeout: 15000 });
    await submitBtn.click();

    await commPage.waitForTimeout(5000);

    const pageText = await commPage.textContent('body') ?? '';
    const appNumMatch = pageText.match(/A-\d{6}/);
    const capturedAppNumber = appNumMatch?.[0] ?? '';
    console.log(`[test] Captured Application Number for submission ${i + 1}:`, capturedAppNumber);

    if (!capturedAppNumber) {
      throw new Error(`Application Number not found in community page for submission ${i + 1}`);
    }

    expect(capturedAppNumber).toMatch(/^A-\d{6}$/);
    capturedAppNumbers.push(capturedAppNumber);

    const sfObjectApiName = 'Application__c';
    const sfLookupField   = 'Name';
    const sfLookupValue   = capturedAppNumber;

    let sfRecordId: string | null = null;
    for (let _attempt = 0; _attempt < 8; _attempt++) {
      const soql = `SELECT Id FROM ${sfObjectApiName} WHERE ${sfLookupField} = '${sfLookupValue}'`;
      const soqlResp = await fetch(
        `${sfInstanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
        { headers: { Authorization: `Bearer ${sfSessionId}` } }
      );
      const soqlData = await soqlResp.json() as { records?: { Id: string }[]; message?: string };
      if (soqlData.message) throw new Error(`SOQL error: ${soqlData.message}`);
      if (soqlData.records?.length) { sfRecordId = soqlData.records[0].Id; break; }
      console.log(`[soql retry ${_attempt + 1}] ${sfLookupValue} not yet queryable — waiting 5s…`);
      await salesPage.waitForTimeout(5000);
    }
    if (!sfRecordId) throw new Error(`${sfLookupValue} not found via SOQL (${sfObjectApiName}.${sfLookupField}) after retries`);
    console.log(`[soql] Found ${sfLookupValue} → ${sfRecordId}`);

    await salesPage.goto(`${lightningOrigin}/lightning/r/${sfObjectApiName}/${sfRecordId}/view`);
    await salesPage.waitForLoadState('domcontentloaded');
    await salesPage.waitForTimeout(2000);

    await expect(salesPage.getByText(data.Email__c, { exact: false }).first()).toBeVisible({ timeout: 30000 });
    await expect(salesPage.getByText(data.School_Name__c, { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(salesPage.getByText(data.GPA__c.toLocaleString('en-US'), { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(salesPage.getByText(data.TestScore__c.toLocaleString('en-US'), { exact: false }).first()).toBeVisible({ timeout: 10000 });

    console.log(`[test] Verified application ${i + 1} in Sales — Application Number: ${capturedAppNumber}`);
  }

  console.log('[test] All captured Application Numbers:', capturedAppNumbers);

  for (let i = 1; i < capturedAppNumbers.length; i++) {
    const prevNum = parseInt(capturedAppNumbers[i - 1].replace('A-', ''), 10);
    const currNum = parseInt(capturedAppNumbers[i].replace('A-', ''), 10);
    expect(currNum).toBeGreaterThan(prevNum);
    console.log(`[test] Sequential increment verified: ${capturedAppNumbers[i - 1]} < ${capturedAppNumbers[i]}`);
  }

  console.log('[test] All Application Numbers are sequential and correctly incremented');
});