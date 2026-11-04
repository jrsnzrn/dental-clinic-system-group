import test from "node:test";
import assert from "node:assert/strict";
import { calculateCharges, money } from "../src/utils/paymentPricing.js";
import { validateReceiptPhotos } from "../src/utils/receiptPhotos.js";

const percentage = { id: "promo", title: "Cleaning offer", services: ["Cleaning"], discountType: "percentage", discountValue: 20 };

test("percentage promo discounts only eligible service charges", () => {
  const result = calculateCharges([{ name: "Cleaning", amount: 1000 }, { name: "X-ray", amount: 500 }], percentage);
  assert.equal(result.grossTotal, 1500);
  assert.equal(result.eligibleTotal, 1000);
  assert.equal(result.discountAmount, 200);
  assert.equal(result.totalCost, 1300);
});

test("fixed promo is shared across booking services and capped at eligible charges", () => {
  const fixed = { ...percentage, discountType: "fixed", discountValue: 500 };
  assert.equal(calculateCharges([{ name: "Cleaning", amount: 400 }], fixed).discountAmount, 400);
  assert.equal(calculateCharges([{ name: "Cleaning", amount: 400 }], fixed, 400).discountAmount, 100);
  assert.equal(calculateCharges([{ name: "Cleaning", amount: 400 }], fixed, 500).discountAmount, 0);
});

test("no promo and noneligible services retain their full charge", () => {
  assert.equal(calculateCharges([{ name: "Cleaning", amount: 800 }]).totalCost, 800);
  assert.equal(calculateCharges([{ name: "Crowns", amount: 800 }], percentage).totalCost, 800);
});

test("100 percent promo can settle an eligible charge without a payment", () => {
  const result = calculateCharges([{ name: "Cleaning", amount: 800 }], { ...percentage, discountValue: 100 });
  assert.equal(result.totalCost, 0);
  assert.equal(result.discountAmount, 800);
});

test("charges round to centavos and reopening uses gross charges without discounting twice", () => {
  const first = calculateCharges([{ name: "Cleaning", amount: 999.99 }], percentage);
  const reopened = calculateCharges(first.serviceCharges, percentage);
  assert.deepEqual(reopened, first);
  assert.equal(first.discountAmount, 200);
  assert.equal(first.totalCost, 799.99);
  assert.equal(money(1.005), 1.01);
  assert.equal(money(Infinity), 0);
});

test("receipt validation accepts photos and rejects oversized or invalid attachments", () => {
  const photo = { name: "receipt.jpg", dataUrl: "data:image/jpeg;base64,YWJj" };
  assert.doesNotThrow(() => validateReceiptPhotos([photo]));
  assert.throws(() => validateReceiptPhotos(Array(4).fill(photo)));
  assert.throws(() => validateReceiptPhotos([{ ...photo, dataUrl: "data:text/html;base64,YWJj" }]));
  assert.throws(() => validateReceiptPhotos([{ ...photo, dataUrl: photo.dataUrl + "A".repeat(200000) }]));
});
