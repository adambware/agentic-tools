const { orders } = require("./stores");
const { publish } = require("./queue");

function createOrder(cart) {
  const order = orders.insert({ cart, status: "pending" });
  publish("OrderPlaced", { orderId: order.id });
  return { status: 202, orderId: order.id };
}

module.exports = { createOrder };
