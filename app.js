// ==== CONFIG (Google Sheet) ====
// same URL you used before
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3iW6s_df7QegGAh0iaReeFJu8_eYKlPduKVgmmh0aLfGSTEeiFFSpcg7Ok47dtRyxug/exec";

// ==== Storage helpers ====
function load(key, fallback) {
	try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
	catch { return fallback; }
}
function save(key, value) {
	localStorage.setItem(key, JSON.stringify(value));
}

// ==== Constants ====
const CATEGORIES = [
	"Shirts",
	"T-Shirts",
	"Hoodies",
	"Jeans",
	"Formal Pants",
	"Track Pants",
];
const CATEGORY_TABS = ["All", ...CATEGORIES];

const DEFAULT_QR_DATA_URL =
	"data:image/svg+xml;utf8," +
	encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'>" +
		"<rect width='100%' height='100%' fill='white'/>" +
		"<rect x='32' y='32' width='448' height='448' fill='black'/>" +
		"<rect x='64' y='64' width='384' height='384' fill='white'/>" +
		"<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='36' font-family='Arial'>QR</text>" +
		"</svg>");

// ==== Seed data ====
function ensureSeed() {
	const seeded = load("__seeded", false);
	if (seeded) return;
	const sample = [
		{ name: "Drop Shoulder T-Shirt", category: "T-Shirts", price: 400, imageSrc: "drop.jpg" } ,
		{ name: "Shirt", category: "Shirts", price: 550, imageSrc: "shirt.webp" },
		{ name: "Sports T-Shirt", category: "T-Shirts", price: 300, imageSrc: "sports.webp" },
		{ name: "Collar T-shirt", category: "T-Shirts", price: 400, imageSrc: "collar.png" } ,
		{ name: "Hoodie", category: "Hoodies", price: 400, imageSrc: "hoodie.png" },
		{ name: "Denim Jeans", category: "Jeans", price: 750, imageSrc: "jeans.png" },
		{ name: "Formal Pant", category: "Formal Pants", price: 750, imageSrc: "formal.png" },
		{ name: "Track Pant", category: "Track Pants", price: 300, imageSrc: "track.png" },

	].map(it => ({ id: String(Date.now() + Math.random()), ...it }));
	save("menuItems", sample);
	save("cart", []);
	save("sales", []);
	save("settings", { qrSrc: DEFAULT_QR_DATA_URL });
	save("__seeded", true);
}

// ==== UI State ====
const state = {
	activeCategory: "All",
	page: 1,
	pageSize: 8,
	lastSale: null
};

// ==== Elements ====
let categoryTabsEl, menuGridEl, paginationEl, prevPageBtn, nextPageBtn, pageInfoEl;
let cartListEl, subtotalTextEl, payNowBtn, printBillBtn, clearCartBtn, downloadPngBtn;
let payNowTopBtn, printBillTopBtn, downloadPngTopBtn, clearCartTopBtn;
let customerNameEl, customerPhoneEl;
let adminToggleBtn, adminPanel, adminCloseBtn, itemForm, itemFormReset;
let itemIdEl, itemNameEl, itemCategoryEl, itemPriceEl, itemImageUrlEl, itemImageFileEl, adminItemListEl;
let settingsForm, qrUrlEl, qrFileEl;
let salesReportMonthlyEl, salesReportDailyEl, exportMonthlyCsvBtn, exportDailyCsvBtn;
let paymentMethodSelect, paymentReferenceInput;

// Modal + print elements
let qrModal, qrCloseBtn, qrImageEl, markPaidBtn;
let receiptDateEl, receiptInvoiceEl, receiptTableBodyEl, receiptSubtotalEl;
let receiptPaymentMethodEl, receiptPaymentRefEl, receiptCustomerNameEl, receiptCustomerPhoneEl;

// ==== Utils ====
function formatCurrency(n) {
	return "₹" + (Math.round(n * 100) / 100).toLocaleString();
}
function dataUrlFromFile(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}
function placeholderImageFor(name) {
	const initials = (name || "?").trim().slice(0, 2).toUpperCase();
	const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>" +
		"<rect width='100%' height='100%' fill='#020617'/>" +
		"<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='48' fill='#9ca3af' font-family='Arial, sans-serif'>" +
		initials +
		"</text></svg>";
	return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
function generateInvoiceNumber(date = new Date()) {
	return "ADG-" + [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
		String(date.getHours()).padStart(2, "0"),
		String(date.getMinutes()).padStart(2, "0"),
		String(date.getSeconds()).padStart(2, "0")
	].join("");
}

// ==== Rendering ====
function renderCategories() {
	categoryTabsEl.innerHTML = "";
	CATEGORY_TABS.forEach(cat => {
		const btn = document.createElement("button");
		btn.className = "tab" + (state.activeCategory === cat ? " active" : "");
		btn.textContent = cat;
		btn.onclick = () => {
			state.activeCategory = cat;
			state.page = 1;
			renderCategories();
			renderMenu();
		};
		categoryTabsEl.appendChild(btn);
	});
}

function renderMenu() {
	const items = load("menuItems", []);
	const filtered = state.activeCategory === "All"
		? items
		: items.filter(m => m.category === state.activeCategory);
	const total = filtered.length;
	const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
	if (state.page > totalPages) state.page = totalPages;
	const start = (state.page - 1) * state.pageSize;
	const pageItems = filtered.slice(start, start + state.pageSize);

	menuGridEl.innerHTML = "";
	pageItems.forEach(it => {
		const card = document.createElement("div");
		card.className = "menu-card";

		const img = document.createElement("img");
		img.src = it.imageSrc || placeholderImageFor(it.name);
		img.alt = it.name;

		const content = document.createElement("div");
		content.className = "content";

		const meta = document.createElement("div");
		meta.className = "meta";
		const nameEl = document.createElement("div");
		nameEl.className = "name";
		nameEl.textContent = it.name;
		const priceEl = document.createElement("div");
		priceEl.className = "price";
		priceEl.textContent = formatCurrency(it.price);
		const tagEl = document.createElement("div");
		tagEl.className = "description";
		tagEl.textContent = it.category;
		meta.appendChild(nameEl);
		meta.appendChild(priceEl);
		meta.appendChild(tagEl);

		const actions = document.createElement("div");
		actions.className = "actions";
		const addBtn = document.createElement("button");
		addBtn.className = "btn primary";
		addBtn.textContent = "Add to Cart";
		addBtn.onclick = () => addToCart(it);
		actions.appendChild(addBtn);

		content.appendChild(meta);
		content.appendChild(actions);
		card.appendChild(img);
		card.appendChild(content);
		menuGridEl.appendChild(card);
	});

	pageInfoEl.textContent = "Page " + state.page + " / " + totalPages;
	prevPageBtn.disabled = state.page <= 1;
	nextPageBtn.disabled = state.page >= totalPages;
	paginationEl.style.display = totalPages > 1 ? "flex" : "none";
}

function renderCart() {
	const cart = load("cart", []);
	cartListEl.innerHTML = "";

	if (!cart.length) {
		const empty = document.createElement("div");
		empty.className = "muted";
		empty.textContent = "Cart is empty";
		cartListEl.appendChild(empty);
		subtotalTextEl.textContent = formatCurrency(0);
		return;
	}

	let subtotal = 0;
	cart.forEach(line => {
		const row = document.createElement("div");
		row.className = "cart-row";

		const title = document.createElement("div");
		title.textContent = line.name;

		const price = document.createElement("div");
		price.textContent = formatCurrency(line.price);

		const qty = document.createElement("div");
		qty.className = "qty";

		const minus = document.createElement("button");
		minus.className = "icon-btn";
		minus.textContent = "−";
		minus.onclick = () => updateQty(line.itemId, -1);

		const qtyText = document.createElement("span");
		qtyText.textContent = String(line.qty);

		const plus = document.createElement("button");
		plus.className = "icon-btn";
		plus.textContent = "+";
		plus.onclick = () => updateQty(line.itemId, +1);

		qty.appendChild(minus);
		qty.appendChild(qtyText);
		qty.appendChild(plus);

		const remove = document.createElement("button");
		remove.className = "btn danger";
		remove.textContent = "Remove";
		remove.onclick = () => removeFromCart(line.itemId);

		row.appendChild(title);
		row.appendChild(price);
		row.appendChild(qty);
		row.appendChild(remove);
		cartListEl.appendChild(row);

		subtotal += line.price * line.qty;
	});
	subtotalTextEl.textContent = formatCurrency(subtotal);
}

function renderAdminItems() {
	const items = load("menuItems", []);
	adminItemListEl.innerHTML = "";
	items.forEach(m => {
		const row = document.createElement("div");
		row.className = "admin-item-row";

		const img = document.createElement("img");
		img.src = m.imageSrc || placeholderImageFor(m.name);
		img.alt = m.name;

		const info = document.createElement("div");
		info.innerHTML = "<div><strong>" + m.name + "</strong></div>" +
			"<div class='muted'>" + m.category + " • " + formatCurrency(m.price) + "</div>";

		const editBtn = document.createElement("button");
		editBtn.className = "btn subtle";
		editBtn.textContent = "Edit";
		editBtn.onclick = () => loadItemIntoForm(m);

		const delBtn = document.createElement("button");
		delBtn.className = "btn danger";
		delBtn.textContent = "Delete";
		delBtn.onclick = () => {
			if (!confirm("Delete this item?")) return;
			const updated = items.filter(x => x.id !== m.id);
			save("menuItems", updated);
			renderAdminItems();
			renderMenu();
		};

		row.appendChild(img);
		row.appendChild(info);
		row.appendChild(editBtn);
		row.appendChild(delBtn);
		adminItemListEl.appendChild(row);
	});
}

function aggregateSales(sales, formatter) {
	const map = new Map();
	for (const sale of sales) {
		const dt = new Date(sale.timestampISO);
		const key = formatter(dt);
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(sale);
	}
	return Array.from(map.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([period, arr]) => ({
			period,
			orders: arr.length,
			total: arr.reduce((sum, s) => sum + (s.subtotal || 0), 0)
		}));
}

function formatPeriodLabel(period, type) {
	if (!period) return "-";
	try {
		if (type === "monthly") {
			const [y, m] = period.split("-").map(Number);
			const d = new Date(y, m - 1, 1);
			return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
		}
		if (type === "daily") {
			const [y, m, d0] = period.split("-").map(Number);
			const d = new Date(y, m - 1, d0);
			return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
		}
	} catch { }
	return period;
}

function renderReportTable(target, rows, firstHeading, periodType) {
	if (!target) return;
	if (!rows.length) {
		target.innerHTML = "<div class='muted'>No sales yet</div>";
		return;
	}
	let html = "<table><thead><tr><th>" + firstHeading + "</th><th>Orders</th><th>Total</th></tr></thead><tbody>";
	for (const row of rows) {
		const label = formatPeriodLabel(row.period, periodType);
		html += "<tr><td>" + label + "</td><td>" + row.orders + "</td><td>" + formatCurrency(row.total) + "</td></tr>";
	}
	html += "</tbody></table>";
	target.innerHTML = html;
}

function renderSalesReport() {
	const sales = load("sales", []);
	const monthlyRows = aggregateSales(sales, dt =>
		dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0"));
	const dailyRows = aggregateSales(sales, dt =>
		[dt.getFullYear(), String(dt.getMonth() + 1).padStart(2, "0"), String(dt.getDate()).padStart(2, "0")].join("-")
	);
	renderReportTable(salesReportMonthlyEl, monthlyRows, "Month", "monthly");
	renderReportTable(salesReportDailyEl, dailyRows, "Date", "daily");
}

// ==== Cart ops ====
function addToCart(item) {
	const cart = load("cart", []);
	const found = cart.find(c => c.itemId === item.id);
	if (found) found.qty += 1;
	else cart.push({ itemId: item.id, name: item.name, price: Number(item.price), qty: 1 });
	save("cart", cart);
	renderCart();
}
function updateQty(itemId, delta) {
	const cart = load("cart", []);
	const found = cart.find(c => c.itemId === itemId);
	if (!found) return;
	found.qty += delta;
	if (found.qty <= 0) {
		const idx = cart.findIndex(c => c.itemId === itemId);
		cart.splice(idx, 1);
	}
	save("cart", cart);
	renderCart();
}
function removeFromCart(itemId) {
	const cart = load("cart", []).filter(c => c.itemId !== itemId);
	save("cart", cart);
	renderCart();
}
function clearCart() {
	if (!confirm("Clear cart?")) return;
	save("cart", []);
	renderCart();
}

// ==== Sale + Google Sheet ====
function buildSaleFromCart(meta = {}) {
	const cart = load("cart", []);
	if (!cart.length) return null;
	const now = meta.timestamp instanceof Date ? meta.timestamp : new Date();
	const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
	const payment = meta.payment || { method: "Pending", reference: "" };
	const invoiceNumber = meta.invoiceNumber || generateInvoiceNumber(now);
	const customer = meta.customer || {
		name: (customerNameEl.value || "").trim() || "Walk-in Customer",
		phone: (customerPhoneEl.value || "").trim()
	};
	return {
		id: String(now.getTime()),
		timestampISO: now.toISOString(),
		invoiceNumber,
		items: cart.map(({ name, price, qty }) => ({ name, price, qty })),
		subtotal,
		payment,
		customer
	};
}

// Google Sheetக்கு sale sync செய்யும் function (local fileலிருந்து வேலை செய்யும்படி)
async function sendSaleToGoogle(sale) {
	if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("http")) return;
	try {
		await fetch(GOOGLE_SCRIPT_URL, {
			method: "POST",
			mode: "no-cors",
			headers: {
				"Content-Type": "text/plain;charset=utf-8"
			},
			body: JSON.stringify({
				type: "sale",
				sale
			})
		});
	} catch (err) {
		console.error("Failed to sync sale to Google:", err);
	}
}

async function recordSale(meta = {}) {
	const sale = buildSaleFromCart(meta);
	if (!sale) return;
	const sales = load("sales", []);
	sales.push(sale);
	save("sales", sales);
	save("cart", []);
	state.lastSale = sale;
	renderCart();
	renderSalesReport();
	await sendSaleToGoogle(sale);
}

// ==== Admin form ====
function loadItemIntoForm(item) {
	itemIdEl.value = item.id;
	itemNameEl.value = item.name;
	itemCategoryEl.value = item.category;
	itemPriceEl.value = item.price;
	itemImageUrlEl.value = item.imageSrc || "";
	itemImageFileEl.value = "";
}

// ==== Receipt helpers ====
function fillReceiptFromSale(sale) {
	if (!sale) return;
	const dt = new Date(sale.timestampISO || new Date());
	receiptDateEl.textContent = dt.toLocaleString();
	receiptInvoiceEl.textContent = "Invoice #: " + (sale.invoiceNumber || "");
	receiptCustomerNameEl.textContent = sale.customer?.name || "Walk-in Customer";
	receiptCustomerPhoneEl.textContent = sale.customer?.phone || "-";

	receiptTableBodyEl.innerHTML = "";
	let subtotal = 0;
	for (const item of sale.items || []) {
		const total = (Number(item.price) || 0) * (Number(item.qty) || 0);
		subtotal += total;
		const tr = document.createElement("tr");
		tr.innerHTML =
			"<td>" + (item.name || "") + "</td>" +
			"<td class='right'>" + (item.qty || 0) + "</td>" +
			"<td class='right'>" + formatCurrency(Number(item.price) || 0) + "</td>" +
			"<td class='right'>" + formatCurrency(total) + "</td>";
		receiptTableBodyEl.appendChild(tr);
	}
	receiptSubtotalEl.textContent = formatCurrency(subtotal || sale.subtotal || 0);
	receiptPaymentMethodEl.textContent = sale.payment?.method || "Pending";
	receiptPaymentRefEl.textContent = sale.payment?.reference || "-";
}

function getSaleForPrintOrPreview() {
	if (state.lastSale) return state.lastSale;
	const cart = load("cart", []);
	if (!cart.length) return null;
	return buildSaleFromCart({});
}

function openPrint() {
	const sale = getSaleForPrintOrPreview();
	if (!sale) {
		alert("No bill to print. Complete a sale or add items first.");
		return;
	}
	fillReceiptFromSale(sale);
	window.print();
}

async function downloadReceiptPng() {
	const sale = getSaleForPrintOrPreview();
	if (!sale) {
		alert("No bill to export. Complete a sale or add items first.");
		return;
	}
	fillReceiptFromSale(sale);
	document.body.classList.add("show-receipt-on-screen");
	const receiptEl = document.querySelector("#printArea .receipt");
	try {
		const canvas = await html2canvas(receiptEl, { scale: 2, backgroundColor: "#ffffff" });
		const link = document.createElement("a");
		link.href = canvas.toDataURL("image/png");
		link.download = (sale.invoiceNumber || "bill") + ".png";
		link.click();
	} catch (err) {
		console.error("PNG export failed:", err);
		alert("PNG export failed. As an alternative, you can take a screenshot.");
	} finally {
		document.body.classList.remove("show-receipt-on-screen");
	}
}

function exportSalesCsv(filename) {
	const sales = load("sales", []);
	if (!sales.length) {
		alert("No sales to export yet.");
		return;
	}
	const header = "Sale Date,Sale Time,Invoice,Customer Name,Customer Phone,Item,Quantity,Unit Price,Line Total,Payment Method,Reference\n";
	const lines = [];
	for (const sale of sales) {
		const dt = new Date(sale.timestampISO);
		const saleDate = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
		const saleTime = dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
		const invoice = (sale.invoiceNumber || "").replace(/"/g, '""');
		const custName = (sale.customer?.name || "").replace(/"/g, '""');
		const custPhone = (sale.customer?.phone || "").replace(/"/g, '""');
		const method = (sale.payment?.method || "").replace(/"/g, '""');
		const reference = (sale.payment?.reference || "").replace(/"/g, '""');
		for (const item of sale.items || []) {
			const itemName = (item.name || "").replace(/"/g, '""');
			const qty = Number(item.qty || 0);
			const unitPrice = Number(item.price || 0);
			const total = unitPrice * qty;
			lines.push([
				`"${saleDate}"`,
				`"${saleTime}"`,
				`"${invoice}"`,
				`"${custName}"`,
				`"${custPhone}"`,
				`"${itemName}"`,
				qty,
				unitPrice.toFixed(2),
				total.toFixed(2),
				`"${method}"`,
				`"${reference}"`
			].join(","));
		}
	}
	const csv = header + lines.join("\n");
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = filename || "sales.csv";
	a.click();
	URL.revokeObjectURL(a.href);
}

// ==== Settings form ====
async function saveSettingsFromForm(e) {
	e.preventDefault();
	const settings = load("settings", { qrSrc: DEFAULT_QR_DATA_URL });
	let qrSrc = qrUrlEl.value.trim();
	if (!qrSrc && qrFileEl.files && qrFileEl.files[0]) {
		qrSrc = await dataUrlFromFile(qrFileEl.files[0]);
	}
	if (qrSrc) settings.qrSrc = qrSrc;
	save("settings", settings);
	alert("Settings saved");
}

// ==== Init ====
async function init() {
	// grab elements
	categoryTabsEl = document.getElementById("categoryTabs");
	menuGridEl = document.getElementById("menuGrid");
	paginationEl = document.getElementById("pagination");
	prevPageBtn = document.getElementById("prevPageBtn");
	nextPageBtn = document.getElementById("nextPageBtn");
	pageInfoEl = document.getElementById("pageInfo");
	cartListEl = document.getElementById("cartList");
	subtotalTextEl = document.getElementById("subtotalText");
	payNowBtn = document.getElementById("payNowBtn");
	printBillBtn = document.getElementById("printBillBtn");
	clearCartBtn = document.getElementById("clearCartBtn");
	downloadPngBtn = document.getElementById("downloadPngBtn");
	payNowTopBtn = document.getElementById("payNowTopBtn");
	printBillTopBtn = document.getElementById("printBillTopBtn");
	downloadPngTopBtn = document.getElementById("downloadPngTopBtn");
	clearCartTopBtn = document.getElementById("clearCartTopBtn");

	customerNameEl = document.getElementById("customerNameInput");
	customerPhoneEl = document.getElementById("customerPhoneInput");

	adminToggleBtn = document.getElementById("adminToggleBtn");
	adminPanel = document.getElementById("adminPanel");
	adminCloseBtn = document.getElementById("adminCloseBtn");
	itemForm = document.getElementById("itemForm");
	itemFormReset = document.getElementById("itemFormReset");
	itemIdEl = document.getElementById("itemId");
	itemNameEl = document.getElementById("itemName");
	itemCategoryEl = document.getElementById("itemCategory");
	itemPriceEl = document.getElementById("itemPrice");
	itemImageUrlEl = document.getElementById("itemImageUrl");
	itemImageFileEl = document.getElementById("itemImageFile");
	adminItemListEl = document.getElementById("adminItemList");

	settingsForm = document.getElementById("settingsForm");
	qrUrlEl = document.getElementById("qrUrl");
	qrFileEl = document.getElementById("qrFile");

	salesReportMonthlyEl = document.getElementById("salesReportMonthly");
	salesReportDailyEl = document.getElementById("salesReportDaily");
	exportMonthlyCsvBtn = document.getElementById("exportMonthlyCsvBtn");
	exportDailyCsvBtn = document.getElementById("exportDailyCsvBtn");
	paymentMethodSelect = document.getElementById("paymentMethodSelect");
	paymentReferenceInput = document.getElementById("paymentReferenceInput");

	qrModal = document.getElementById("qrModal");
	qrCloseBtn = document.getElementById("qrCloseBtn");
	qrImageEl = document.getElementById("qrImage");
	markPaidBtn = document.getElementById("markPaidBtn");

	receiptDateEl = document.getElementById("receiptDate");
	receiptInvoiceEl = document.getElementById("receiptInvoice");
	receiptTableBodyEl = document.querySelector("#receiptTable tbody");
	receiptSubtotalEl = document.getElementById("receiptSubtotal");
	receiptPaymentMethodEl = document.getElementById("receiptPaymentMethod");
	receiptPaymentRefEl = document.getElementById("receiptPaymentRef");
	receiptCustomerNameEl = document.getElementById("receiptCustomerName");
	receiptCustomerPhoneEl = document.getElementById("receiptCustomerPhone");

	ensureSeed();

	itemCategoryEl.innerHTML = CATEGORIES
		.map(c => "<option value=\"" + c + "\">" + c + "</option>").join("");

	renderCategories();
	renderMenu();
	renderCart();
	renderAdminItems();
	renderSalesReport();

	// Pay Now
	payNowBtn.onclick = () => {
		const cart = load("cart", []);
		if (!cart.length) {
			alert("Cart is empty. Add items before payment.");
			return;
		}
		const settings = load("settings", { qrSrc: DEFAULT_QR_DATA_URL });
		qrImageEl.src = settings.qrSrc || DEFAULT_QR_DATA_URL;
		if (paymentMethodSelect) {
			paymentMethodSelect.value = "Cash";
		}
		if (paymentReferenceInput) {
			paymentReferenceInput.value = "";
		}
		qrModal.classList.remove("hidden");
	};
	payNowTopBtn.onclick = () => payNowBtn.onclick();

	qrCloseBtn.onclick = () => qrModal.classList.add("hidden");

	markPaidBtn.onclick = async () => {
		const cart = load("cart", []);
		if (!cart.length) {
			alert("Cart is empty. Add items before marking paid.");
			return;
		}
		const method = (paymentMethodSelect?.value || "Cash");
		const reference = (paymentReferenceInput?.value || "").trim() || "-";
		const payment = { method, reference };
		const timestamp = new Date();
		const invoiceNumber = generateInvoiceNumber(timestamp);
		const customer = {
			name: (customerNameEl.value || "").trim() || "Walk-in Customer",
			phone: (customerPhoneEl.value || "").trim()
		};
		await recordSale({ payment, timestamp, invoiceNumber, customer });
		qrModal.classList.add("hidden");
	};

	// Print + PNG
	printBillBtn.onclick = () => openPrint();
	printBillTopBtn.onclick = () => openPrint();
	downloadPngBtn.onclick = () => downloadReceiptPng();
	downloadPngTopBtn.onclick = () => downloadReceiptPng();

	// Clear cart
	clearCartBtn.onclick = () => clearCart();
	clearCartTopBtn.onclick = () => clearCart();

	// Pagination
	prevPageBtn.onclick = () => {
		if (state.page > 1) {
			state.page -= 1;
			renderMenu();
		}
	};
	nextPageBtn.onclick = () => {
		state.page += 1;
		renderMenu();
	};

	// Admin
	adminToggleBtn.onclick = () => adminPanel.classList.remove("hidden");
	adminCloseBtn.onclick = () => adminPanel.classList.add("hidden");

	itemForm.addEventListener("submit", async e => {
		e.preventDefault();
		const id = itemIdEl.value || String(Date.now() + Math.random());
		const name = itemNameEl.value.trim();
		const category = itemCategoryEl.value;
		const price = Number(itemPriceEl.value);
		let imageSrc = itemImageUrlEl.value.trim();
		if (!imageSrc && itemImageFileEl.files && itemImageFileEl.files[0]) {
			imageSrc = await dataUrlFromFile(itemImageFileEl.files[0]);
		}
		const items = load("menuItems", []);
		const idx = items.findIndex(x => x.id === id);
		const payload = { id, name, category, price, imageSrc };
		if (idx >= 0) items[idx] = payload;
		else items.push(payload);
		save("menuItems", items);
		itemForm.reset();
		itemIdEl.value = "";
		renderAdminItems();
		renderMenu();
	});
	itemFormReset.onclick = () => { itemIdEl.value = ""; };

	settingsForm.addEventListener("submit", saveSettingsFromForm);

	// CSV export (both buttons export full log)
	exportMonthlyCsvBtn.onclick = () => exportSalesCsv("sales.csv");
	exportDailyCsvBtn.onclick = () => exportSalesCsv("sales.csv");

	// Esc closes modals
	window.addEventListener("keydown", e => {
		if (e.key === "Escape") {
			if (!qrModal.classList.contains("hidden")) qrModal.classList.add("hidden");
			if (!adminPanel.classList.contains("hidden")) adminPanel.classList.add("hidden");
		}
	});
}

document.addEventListener("DOMContentLoaded", init);
