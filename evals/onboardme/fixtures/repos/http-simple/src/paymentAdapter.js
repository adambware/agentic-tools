function chargeCard(token, amountCents) {
  return { chargeId: `ch_${token}`, amountCents };
}

module.exports = { chargeCard };
