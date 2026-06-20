document.addEventListener("input", (event) => {
  const input = event.target;
  if (!input.matches("input[name='symbol']")) return;
  input.value = input.value.toUpperCase();
});

document.addEventListener("change", (event) => {
  const select = event.target;
  if (!select.matches("[data-order-type]")) return;
  const form = select.closest("form");
  const limitInput = form.querySelector("input[name='limitPrice']");
  if (!limitInput) return;
  limitInput.required = select.value === "limit";
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-password-toggle]");
  if (!button) return;
  const field = button.closest(".password-field");
  const input = field?.querySelector("[data-password-input]");
  if (!input) return;
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  button.textContent = showing ? "Show" : "Hide";
});
