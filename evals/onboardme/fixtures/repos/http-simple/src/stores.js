const orders = {
  insert(order) {
    return { id: "ord_1", ...order };
  },
  find(orderId) {
    return { id: orderId, cart: { paymentToken: "tok_1", totalCents: 1299, sku: "sku_1", quantity: 1 } };
  },
  updateStatus(orderId, status) {
    return { orderId, status };
  },
};

const inventory = {
  reserve(sku, quantity) {
    return { sku, quantity };
  },
};

module.exports = { orders, inventory };
