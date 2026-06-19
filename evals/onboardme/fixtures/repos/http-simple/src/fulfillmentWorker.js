const { orders, inventory } = require("./stores");
const { chargeCard } = require("./paymentAdapter");

function handleOrderPlaced(message) {
  const order = orders.find(message.orderId);
  chargeCard(order.cart.paymentToken, order.cart.totalCents);
  inventory.reserve(order.cart.sku, order.cart.quantity);
  orders.updateStatus(order.id, "confirmed");
}

module.exports = { handleOrderPlaced };
