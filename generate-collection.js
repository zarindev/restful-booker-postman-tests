const fs = require('fs');
const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

function jsHeader(contentType = true) {
  const headers = [];
  if (contentType) {
    headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
  }
  return headers;
}

function authCookieHeader() {
  return [
    { key: 'Content-Type', value: 'application/json', type: 'text' },
    { key: 'Cookie', value: 'token={{token}}', type: 'text' },
  ];
}

function url(pathSegments, query = []) {
  const path = pathSegments.filter(Boolean);
  const rawPath = path.join('/');
  const rawQuery = query.length
    ? '?' + query.map((q) => `${q.key}=${q.value}`).join('&')
    : '';
  return {
    raw: `{{baseUrl}}/${rawPath}${rawQuery}`,
    host: ['{{baseUrl}}'],
    path,
    ...(query.length ? { query } : {}),
  };
}

function rawBody(obj) {
  return {
    mode: 'raw',
    raw: JSON.stringify(obj, null, 2),
    options: { raw: { language: 'json' } },
  };
}

function testEvent(lines) {
  return { listen: 'test', script: { type: 'text/javascript', exec: lines } };
}

function preRequestEvent(lines) {
  return { listen: 'prerequest', script: { type: 'text/javascript', exec: lines } };
}

function request({ name, method, header = [], body, path, query, events = [], description }) {
  const req = {
    name,
    event: events,
    request: {
      method,
      header,
      url: url(path, query),
      ...(description ? { description } : {}),
    },
    response: [],
  };
  if (body) req.request.body = body;
  return req;
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------
const healthCheckFolder = {
  name: '1. Health Check',
  item: [
    request({
      name: 'Ping API (Health Check)',
      method: 'GET',
      path: ['ping'],
      description:
        'Confirms the API is reachable before running the rest of the suite. Per the API docs, a healthy response is HTTP 201 -- an unusual choice for a read-only health check, but that is the documented, correct behavior for this API, not a defect.',
      events: [
        testEvent([
          "pm.test('API is up: status code is 201', function () {",
          '    pm.response.to.have.status(201);',
          '});',
        ]),
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
const authFolder = {
  name: '2. Authentication',
  item: [
    request({
      name: 'Create Auth Token (Valid Credentials)',
      method: 'POST',
      header: jsHeader(),
      path: ['auth'],
      body: rawBody({ username: '{{username}}', password: '{{password}}' }),
      description:
        'Exchanges the documented public test credentials for an auth token, required for PUT/PATCH/DELETE on the booking endpoints. The token is stored in the environment for downstream requests to reuse -- this is API chaining, not a hardcoded value.',
      events: [
        testEvent([
          "pm.test('Status code is 200', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          "pm.test('Response contains a token', function () {",
          '    const jsonData = pm.response.json();',
          "    pm.expect(jsonData).to.have.property('token');",
          "    pm.environment.set('token', jsonData.token);",
          '});',
        ]),
      ],
    }),
    request({
      name: 'Create Auth Token (Invalid Credentials — Negative)',
      method: 'POST',
      header: jsHeader(),
      path: ['auth'],
      body: rawBody({ username: 'not_a_real_user', password: 'wrong_password' }),
      description:
        "Documents actual API behavior for bad credentials, which is worth calling out: this API returns HTTP 200 with a { reason: 'Bad credentials' } body rather than a 401/403. Testing what an API actually does, not what REST conventions say it should do, is the point of this request.",
      events: [
        testEvent([
          "pm.test('Status code is 200 (this API does not use 401 for bad auth)', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          "pm.test('Response indicates bad credentials, not a token', function () {",
          '    const jsonData = pm.response.json();',
          "    pm.expect(jsonData).to.not.have.property('token');",
          "    pm.expect(jsonData).to.have.property('reason', 'Bad credentials');",
          '});',
        ]),
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Create Booking
// ---------------------------------------------------------------------------
const createBookingFolder = {
  name: '3. Create Booking',
  item: [
    request({
      name: 'Create New Booking',
      method: 'POST',
      header: jsHeader(),
      path: ['booking'],
      body: rawBody({
        firstname: '{{$randomFirstName}}',
        lastname: '{{$randomLastName}}',
        totalprice: '{{$randomInt}}',
        depositpaid: true,
        bookingdates: {
          checkin: '{{checkinDate}}',
          checkout: '{{checkoutDate}}',
        },
        additionalneeds: 'Breakfast',
      }),
      description:
        'Creates a booking with dynamically generated data (unique name/price per run, computed dates) rather than a fixed fixture, and stores the returned bookingid plus the submitted name for every downstream request in this collection to chain against.',
      events: [
        preRequestEvent([
          'const today = new Date();',
          'const checkin = new Date(today);',
          'checkin.setDate(today.getDate() + 3);',
          'const checkout = new Date(today);',
          'checkout.setDate(today.getDate() + 7);',
          '',
          'function formatDate(d) {',
          "    return d.toISOString().split('T')[0];",
          '}',
          '',
          "pm.environment.set('checkinDate', formatDate(checkin));",
          "pm.environment.set('checkoutDate', formatDate(checkout));",
        ]),
        testEvent([
          "pm.test('Status code is 200', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          "pm.test('Response contains a bookingid', function () {",
          '    const jsonData = pm.response.json();',
          "    pm.expect(jsonData).to.have.property('bookingid');",
          "    pm.environment.set('bookingId', jsonData.bookingid);",
          '});',
          '',
          "pm.test('Created booking matches the submitted data', function () {",
          '    const jsonData = pm.response.json();',
          '    const requestBody = JSON.parse(pm.request.body.raw);',
          '',
          '    pm.expect(jsonData.booking.firstname).to.eql(requestBody.firstname);',
          '    pm.expect(jsonData.booking.lastname).to.eql(requestBody.lastname);',
          '    pm.expect(jsonData.booking.totalprice).to.eql(requestBody.totalprice);',
          '    pm.expect(jsonData.booking.depositpaid).to.eql(requestBody.depositpaid);',
          '',
          "    pm.environment.set('createdFirstName', jsonData.booking.firstname);",
          "    pm.environment.set('createdLastName', jsonData.booking.lastname);",
          '});',
        ]),
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Read Bookings
// ---------------------------------------------------------------------------
const readBookingFolder = {
  name: '4. Read Bookings',
  item: [
    request({
      name: 'Get All Booking IDs',
      method: 'GET',
      path: ['booking'],
      description: 'Sanity check that the booking list endpoint returns a non-empty array of {bookingid} objects.',
      events: [
        testEvent([
          "pm.test('Status code is 200', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          "pm.test('Response is a non-empty array', function () {",
          '    const jsonData = pm.response.json();',
          "    pm.expect(jsonData).to.be.an('array');",
          '    pm.expect(jsonData.length).to.be.above(0);',
          '});',
        ]),
      ],
    }),
    request({
      name: 'Get Booking By ID (Chained From Create)',
      method: 'GET',
      path: ['booking', '{{bookingId}}'],
      description:
        'Verifies the booking created earlier in this run is actually retrievable and matches what was submitted -- this is what makes it a real end-to-end check rather than two isolated requests that happen to run in the same collection.',
      events: [
        testEvent([
          "pm.test('Status code is 200', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          "pm.test('Returned booking matches the one created earlier', function () {",
          '    const jsonData = pm.response.json();',
          "    pm.expect(jsonData.firstname).to.eql(pm.environment.get('createdFirstName'));",
          "    pm.expect(jsonData.lastname).to.eql(pm.environment.get('createdLastName'));",
          '});',
        ]),
      ],
    }),
    request({
      name: 'Get Nonexistent Booking (Negative)',
      method: 'GET',
      path: ['booking', '999999999'],
      description: 'A booking ID this large should never exist -- confirms the API returns 404 rather than an empty 200 or a 500.',
      events: [
        testEvent([
          "pm.test('Status code is 404', function () {",
          '    pm.response.to.have.status(404);',
          '});',
        ]),
      ],
    }),
    request({
      name: 'Filter Bookings By Checkout Date (Documented Community Issue — Read Only)',
      method: 'GET',
      path: ['booking'],
      query: [{ key: 'checkout', value: '{{checkoutDate}}' }],
      description:
        'IMPORTANT: multiple independent QA practitioners who have tested this API report that filtering by checkout date returns inconsistent/unreliable results (see README). This request does not assert a specific pass/fail outcome, since that community-reported behavior has not been personally re-verified as part of building this collection -- it logs the actual response so you can inspect it and decide whether to harden this into a real assertion after confirming current behavior yourself.',
      events: [
        testEvent([
          "pm.test('Request completes (status code is 200)', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          '// Deliberately not asserting on the contents of this response --',
          '// see the request description and README for why.',
          'console.log("Checkout-date filter response:", pm.response.text());',
        ]),
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Update Booking
// ---------------------------------------------------------------------------
const updateBookingFolder = {
  name: '5. Update Booking',
  item: [
    request({
      name: 'Update Booking Without Auth (Negative)',
      method: 'PUT',
      header: jsHeader(),
      path: ['booking', '{{bookingId}}'],
      body: rawBody({
        firstname: 'ShouldNot',
        lastname: 'Apply',
        totalprice: 1,
        depositpaid: false,
        bookingdates: { checkin: '{{checkinDate}}', checkout: '{{checkoutDate}}' },
        additionalneeds: 'None',
      }),
      description:
        'Runs BEFORE the authenticated update so this is a clean check of the auth guard itself, not a coincidental pass caused by test order.',
      events: [
        testEvent([
          "pm.test('Status code is 403 without an auth token', function () {",
          '    pm.response.to.have.status(403);',
          '});',
        ]),
      ],
    }),
    request({
      name: 'Update Booking (Full — With Auth)',
      method: 'PUT',
      header: authCookieHeader(),
      path: ['booking', '{{bookingId}}'],
      body: rawBody({
        firstname: 'Updated',
        lastname: 'Guest',
        totalprice: 999,
        depositpaid: false,
        bookingdates: { checkin: '{{checkinDate}}', checkout: '{{checkoutDate}}' },
        additionalneeds: 'Late Checkout',
      }),
      description: 'A full PUT replaces every field -- this asserts the ENTIRE response matches what was submitted, not just one field.',
      events: [
        testEvent([
          "pm.test('Status code is 200', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          "pm.test('All fields were updated as submitted', function () {",
          '    const jsonData = pm.response.json();',
          '    const requestBody = JSON.parse(pm.request.body.raw);',
          '',
          '    pm.expect(jsonData.firstname).to.eql(requestBody.firstname);',
          '    pm.expect(jsonData.lastname).to.eql(requestBody.lastname);',
          '    pm.expect(jsonData.totalprice).to.eql(requestBody.totalprice);',
          '    pm.expect(jsonData.depositpaid).to.eql(requestBody.depositpaid);',
          '    pm.expect(jsonData.additionalneeds).to.eql(requestBody.additionalneeds);',
          '',
          "    pm.environment.set('updatedFirstName', jsonData.firstname);",
          "    pm.environment.set('updatedLastName', jsonData.lastname);",
          '});',
        ]),
      ],
    }),
    request({
      name: 'Update Booking Partially Without Auth (Negative)',
      method: 'PATCH',
      header: jsHeader(),
      path: ['booking', '{{bookingId}}'],
      body: rawBody({ additionalneeds: 'Should Not Apply' }),
      events: [
        testEvent([
          "pm.test('Status code is 403 without an auth token', function () {",
          '    pm.response.to.have.status(403);',
          '});',
        ]),
      ],
    }),
    request({
      name: 'Update Booking Partially (PATCH — With Auth)',
      method: 'PATCH',
      header: authCookieHeader(),
      path: ['booking', '{{bookingId}}'],
      body: rawBody({ additionalneeds: 'Late Checkout, Extra Towels' }),
      description:
        'A PATCH should change only the field(s) submitted. This explicitly checks that firstname/lastname from the prior PUT are untouched, not just that the new field applied -- a partial update that quietly resets other fields is a real, easy-to-miss bug class.',
      events: [
        testEvent([
          "pm.test('Status code is 200', function () {",
          '    pm.response.to.have.status(200);',
          '});',
          '',
          "pm.test('Only the submitted field changed', function () {",
          '    const jsonData = pm.response.json();',
          '',
          "    pm.expect(jsonData.additionalneeds).to.eql('Late Checkout, Extra Towels');",
          "    pm.expect(jsonData.firstname).to.eql(pm.environment.get('updatedFirstName'));",
          "    pm.expect(jsonData.lastname).to.eql(pm.environment.get('updatedLastName'));",
          '});',
        ]),
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Delete Booking
// ---------------------------------------------------------------------------
const deleteBookingFolder = {
  name: '6. Delete Booking',
  item: [
    request({
      name: 'Delete Booking Without Auth (Negative)',
      method: 'DELETE',
      path: ['booking', '{{bookingId}}'],
      description:
        'Runs BEFORE the real delete deliberately: the booking must still exist for this to be a genuine "rejected due to no auth" check, not a coincidental result caused by test order.',
      events: [
        testEvent([
          "pm.test('Status code is 403 without an auth token', function () {",
          '    pm.response.to.have.status(403);',
          '});',
        ]),
      ],
    }),
    request({
      name: 'Delete Booking (With Auth)',
      method: 'DELETE',
      header: [{ key: 'Cookie', value: 'token={{token}}', type: 'text' }],
      path: ['booking', '{{bookingId}}'],
      description: 'Per the API docs, a successful delete returns 201, not 200 or 204 -- documented, correct behavior for this API.',
      events: [
        testEvent([
          "pm.test('Status code is 201 (documented behavior for this API)', function () {",
          '    pm.response.to.have.status(201);',
          '});',
        ]),
      ],
    }),
    request({
      name: 'Verify Deletion (Get Deleted Booking — Negative)',
      method: 'GET',
      path: ['booking', '{{bookingId}}'],
      description:
        'A 201 from the delete request only proves the API accepted the request -- this confirms the booking is actually gone, which is the part that matters.',
      events: [
        testEvent([
          "pm.test('Status code is 404: the booking no longer exists', function () {",
          '    pm.response.to.have.status(404);',
          '});',
        ]),
      ],
    }),
  ],
};

const collection = {
  info: {
    _postman_id: uuid(),
    name: 'Restful Booker API — QA Automation Collection',
    description:
      'A demo/practice API test collection against Restful-Booker (https://restful-booker.herokuapp.com), a public API testing playground built by Mark Winteringham specifically for QA practice. This is not a paid client engagement. See README.md for full context, the documented public test credentials used, and the community-reported issue this collection deliberately does not paper over.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    healthCheckFolder,
    authFolder,
    createBookingFolder,
    readBookingFolder,
    updateBookingFolder,
    deleteBookingFolder,
  ],
};

fs.writeFileSync(
  'collections/Restful-Booker-API.postman_collection.json',
  JSON.stringify(collection, null, 2),
);

console.log('Wrote collections/Restful-Booker-API.postman_collection.json');
