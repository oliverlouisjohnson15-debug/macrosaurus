'use strict';
// The sign-up typo check. A wrong domain means the confirmation email goes nowhere and the person
// never gets in, so the common slips must be caught; but a real domain that merely resembles a
// big provider must be left alone, or we nag people about their own work address.
const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('./helpers/app.js');
const { emailTypo, emailLooksValid } = app();

test('catches the slips people actually make', () => {
  const cases = {
    'sam@gmial.com': 'sam@gmail.com', 'sam@gmal.com': 'sam@gmail.com', 'sam@gmail.con': 'sam@gmail.com',
    'sam@gmail.co': 'sam@gmail.com', 'sam@gmail.co.uk': 'sam@gmail.com', 'sam@gmail': 'sam@gmail.com',
    'sam@hotmial.co.uk': 'sam@hotmail.co.uk', 'sam@hotmail.couk': 'sam@hotmail.co.uk', 'sam@hotmail.co': 'sam@hotmail.com',
    'sam@outlok.com': 'sam@outlook.com', 'sam@outloook.com': 'sam@outlook.com', 'sam@yaho.co.uk': 'sam@yahoo.co.uk',
    'sam@icloud.cm': 'sam@icloud.com', 'Sam@GMIAL.com ': 'sam@gmail.com', 'sam@btinternet.con': 'sam@btinternet.com',
  };
  for (const [typed, want] of Object.entries(cases)) assert.strictEqual(emailTypo(typed), want, typed);
});

test('leaves correct and unrelated addresses alone', () => {
  for (const ok of ['sam@gmail.com', 'sam@hotmail.co.uk', 'sam@outlook.com', 'sam@live.co.uk', 'sam@uberip.com',
    'sam@mail.com', 'sam@bt.com', 'sam@nhs.net', 'sam@yahoo.fr', 'sam@outlook.fr', 'sam@company.co.uk', 'sam@ox.ac.uk', '', 'sam', 'sam@'])
    assert.strictEqual(emailTypo(ok), null, ok);
});

test('shape check', () => {
  assert.ok(emailLooksValid('a@b.co'));
  assert.ok(emailLooksValid(' sam@gmail.com '));
  for (const bad of ['sam@gmail', 'sam gmail.com', 'sam@@gmail.com', 'sam@gmail.c', '@gmail.com']) assert.ok(!emailLooksValid(bad), bad);
});
