// ==== CONFIG (Google Sheet) ====
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyZrl1naOGWgR66dhqzEDIY9B3J-TUYOJcMl-BPo4dNv3eer3HGZYmmFDWkLpQuNLR6Xw/exec";

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

// ==== Seed / defaults ====
function ensureSeed() {
    const settings = load("settings", null);
    if (!settings) {
        save("settings", { qrSrc: DEFAULT_QR_DATA_URL });
    }
    if (load("cart", null) == null) save("cart", []);
    if (load("sales", null) == null) save("sales", []);
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
let itemStockEl;
let settingsForm, qrUrlEl, qrFileEl;
let salesReportMonthlyEl, salesReportDailyEl, exportMonthlyCsvBtn, exportDailyCsvBtn;
let paymentMethodSelect, paymentReferenceInput;

let qrModal, qrCloseBtn, qrImageEl, markPaidBtn;
let receiptDateEl, receiptInvoiceEl, receiptTableBodyEl, receiptSubtotalEl;
let receiptPaymentMethodEl, receiptPaymentRefEl, receiptCustomerNameEl, receiptCustomerPhoneEl;
let receiptDiscountEl, receiptGrandTotalEl;

let discountInputEl, rawSubtotalTextEl;

let authModal, authForm, authEmail, authPassword;

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

// ==== Firebase helpers for inventory + settings ====
async function fetchMenuFromCloud() {
    if (!window.db || !window.collection || !window.getDocs) return null;
    const colRef = window.collection(window.db, "menuItems");
    const snap = await window.getDocs(colRef);
    const items = [];
    snap.forEach(docSnap => {
        const data = docSnap.data() || {};
        items.push({
            id: docSnap.id,
            name: data.name || "",
            category: data.category || "",
            price: Number(data.price || 0),
            stock: typeof data.stock === "number" ? data.stock : 0,
            imageSrc: data.imageSrc || ""
        });
    });
    return items;
}

async function syncInventoryFromCloud() {
    try {
        const items = await fetchMenuFromCloud();
        if (items && items.length) {
            save("menuItems", items);
        }
    } catch (err) {
        console.error("Failed to sync inventory from cloud:", err);
    }
}

async function upsertMenuItemCloud(item) {
    if (!window.db || !window.doc || !window.setDoc) return;
    const docRef = window.doc(window.db, "menuItems", item.id);
    await window.setDoc(docRef, {
        name: item.name,
        category: item.category,
        price: Number(item.price || 0),
        stock: Number(item.stock || 0),
        imageSrc: item.imageSrc || ""
    });
}

async function deleteMenuItemCloud(id) {
    if (!window.db || !window.doc || !window.deleteDoc) return;
    const docRef = window.doc(window.db, "menuItems", id);
    await window.deleteDoc(docRef);
}

async function updateMenuItemStockCloud(id, stock) {
    if (!window.db || !window.doc || !window.updateDoc) return;
    const docRef = window.doc(window.db, "menuItems", id);
    await window.updateDoc(docRef, { stock: Number(stock || 0) });
}

async function fetchSettingsFromCloud() {
    if (!window.db || !window.doc || !window.getDoc) return null;
    const docRef = window.doc(window.db, "settings", "general");
    const snap = await window.getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data();
}

async function saveSettingsToCloud(settings) {
    if (!window.db || !window.doc || !window.setDoc) return;
    const docRef = window.doc(window.db, "settings", "general");
    await window.setDoc(docRef, settings, { merge: true });
}

async function syncSettingsFromCloud() {
    try {
        const cloudSettings = await fetchSettingsFromCloud();
        if (cloudSettings) {
            save("settings", cloudSettings);
        }
    } catch (err) {
        console.error("Failed to sync settings from cloud:", err);
    }
}

// Cart qty helper for menu
function getCartQtyForItem(itemId) {
    const cart = load("cart", []);
    const found = cart.find(c => c.itemId === itemId);
    return found ? found.qty : 0;
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

        const totalStock = typeof it.stock === "number" ? it.stock : null;
        const cartQty = getCartQtyForItem(it.id);
        const availableStock = totalStock != null
            ? Math.max(0, totalStock - cartQty)
            : null;

        const stockEl = document.createElement("div");
        stockEl.className = "muted";
        stockEl.textContent = availableStock != null
            ? ("Stock: " + availableStock)
            : "Stock: -";

        meta.appendChild(nameEl);
        meta.appendChild(priceEl);
        meta.appendChild(tagEl);
        meta.appendChild(stockEl);

        const actions = document.createElement("div");
        actions.className = "actions";

        if (availableStock !== null && availableStock <= 0) {
            const outBtn = document.createElement("button");
            outBtn.className = "btn";
            outBtn.disabled = true;
            outBtn.textContent = "Out of stock";
            actions.appendChild(outBtn);
        } else if (cartQty > 0) {
            const qtyWrapper = document.createElement("div");
            qtyWrapper.className = "qty";

            const minusBtn = document.createElement("button");
            minusBtn.className = "icon-btn";
            minusBtn.textContent = "−";
            minusBtn.onclick = () => updateQty(it.id, -1);

            const qtySpan = document.createElement("span");
            qtySpan.textContent = String(cartQty);

            const plusBtn = document.createElement("button");
            plusBtn.className = "icon-btn";
            plusBtn.textContent = "+";
            plusBtn.onclick = () => updateQty(it.id, +1);

            qtyWrapper.appendChild(minusBtn);
            qtyWrapper.appendChild(qtySpan);
            qtyWrapper.appendChild(plusBtn);
            actions.appendChild(qtyWrapper);
        } else {
            const addBtn = document.createElement("button");
            addBtn.className = "btn primary";
            addBtn.textContent = "Add to Cart";
            addBtn.onclick = () => addToCart(it);
            actions.appendChild(addBtn);
        }

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
        if (rawSubtotalTextEl) rawSubtotalTextEl.textContent = formatCurrency(0);
        subtotalTextEl.textContent = formatCurrency(0);
        return;
    }

    let subtotal = 0;
    cart.forEach(line => {
        const row = document.createElement("div");
        row.className = "cart-row";

        const title = document.createElement("div");
        title.textContent = line.name;

        const priceWrapper = document.createElement("div");
        const priceInput = document.createElement("input");
        priceInput.type = "number";
        priceInput.min = "0";
        priceInput.value = Number(line.price || 0);
        priceInput.className = "price-input";
        priceInput.onchange = () => {
            const newPrice = Number(priceInput.value) || 0;
            line.price = newPrice;
            save("cart", cart);
            renderCart();
            renderMenu();
        };
        priceWrapper.appendChild(priceInput);

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
        remove.textContent = "X";
        remove.onclick = () => removeFromCart(line.itemId);

        row.appendChild(title);
        row.appendChild(priceWrapper);
        row.appendChild(qty);
        row.appendChild(remove);
        cartListEl.appendChild(row);

        subtotal += line.price * line.qty;
    });

    if (rawSubtotalTextEl) {
        rawSubtotalTextEl.textContent = formatCurrency(subtotal);
    }

    let discount = 0;
    if (discountInputEl) {
        discount = Number(discountInputEl.value || 0);
        if (discount < 0) discount = 0;
        if (discount > subtotal) discount = subtotal;
        discountInputEl.value = discount;
    }

    const finalTotal = subtotal - discount;
    subtotalTextEl.textContent = formatCurrency(finalTotal);
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

        const stockText = typeof m.stock === "number" ? (" • Stock: " + m.stock) : "";
        const info = document.createElement("div");
        info.innerHTML = "<div><strong>" + m.name + "</strong></div>" +
            "<div class='muted'>" + m.category + " • " + formatCurrency(m.price) + stockText + "</div>";

        const editBtn = document.createElement("button");
        editBtn.className = "btn subtle";
        editBtn.textContent = "Edit";
        editBtn.onclick = () => loadItemIntoForm(m);

        const delBtn = document.createElement("button");
        delBtn.className = "btn danger";
        delBtn.textContent = "Delete";
        delBtn.onclick = async () => {
            if (!confirm("Delete this item?")) return;
            const items = load("menuItems", []);
            const updated = items.filter(x => x.id !== m.id);
            save("menuItems", updated);
            await deleteMenuItemCloud(m.id);
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
            total: arr.reduce((sum, s) => sum + (s.grandTotal ?? s.subtotal ?? 0), 0)
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
    const items = load("menuItems", []);
    const fullItem = items.find(m => m.id === item.id) || item;
    const stock = typeof fullItem.stock === "number" ? fullItem.stock : null;

    const cart = load("cart", []);
    const found = cart.find(c => c.itemId === item.id);
    const currentQty = found ? found.qty : 0;

    if (stock !== null && currentQty >= stock) {
        alert("No more stock available for this item.");
        return;
    }

    if (found) found.qty += 1;
    else cart.push({ itemId: item.id, name: item.name, price: Number(item.price), qty: 1 });

    save("cart", cart);
    renderCart();
    renderMenu();
}

function updateQty(itemId, delta) {
    const cart = load("cart", []);
    const found = cart.find(c => c.itemId === itemId);
    if (!found) return;

    const items = load("menuItems", []);
    const fullItem = items.find(m => m.id === itemId);
    const stock = typeof fullItem?.stock === "number" ? fullItem.stock : null;

    const newQty = found.qty + delta;
    if (stock !== null && newQty > stock) {
        alert("Cannot exceed stock.");
        return;
    }

    found.qty = newQty;

    if (found.qty <= 0) {
        const idx = cart.findIndex(c => c.itemId === itemId);
        cart.splice(idx, 1);
    }
    save("cart", cart);
    renderCart();
    renderMenu();
}

function removeFromCart(itemId) {
    const cart = load("cart", []).filter(c => c.itemId !== itemId);
    save("cart", cart);
    renderCart();
    renderMenu();
}

function clearCart() {
    if (!confirm("Clear cart?")) return;
    save("cart", []);
    renderCart();
    renderMenu();
}

// ==== Sale + Sheets ====
function buildSaleFromCart(meta = {}) {
    const cart = load("cart", []);
    if (!cart.length) return null;

    const now = meta.timestamp instanceof Date ? meta.timestamp : new Date();
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

    let discount = 0;
    if (typeof meta.discount === "number") {
        discount = meta.discount;
    } else if (discountInputEl) {
        discount = Number(discountInputEl.value || 0);
    }
    if (discount < 0) discount = 0;
    if (discount > subtotal) discount = subtotal;

    const grandTotal = subtotal - discount;
    const payment = meta.payment || { method: "Pending", reference: "" };
    const invoiceNumber = meta.invoiceNumber || generateInvoiceNumber(now);
    const customer = meta.customer || {
        name: (customerNameEl.value || "").trim() || "Walk-in Customer",
        phone: (customerPhoneEl.value || "").trim()
    };

    const inventory = load("menuItems", []);
    const items = cart.map(({ itemId, name, price, qty }) => {
        const inv = inventory.find(m => m.id === itemId);
        const stockBefore = typeof inv?.stock === "number" ? inv.stock : null;
        const stockAfter = stockBefore != null ? Math.max(0, stockBefore - qty) : null;
        return {
            itemId,
            name,
            price: Number(price),
            qty,
            stockBefore,
            stockAfter
        };
    });

    return {
        id: String(now.getTime()),
        timestampISO: now.toISOString(),
        invoiceNumber,
        items,
        subtotal,
        discount,
        grandTotal,
        payment,
        customer
    };
}

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
    if (!window.auth || !window.auth.currentUser) {
        alert("ACTION BLOCKED: You must be logged in to record a sale.");
        return; 
    }
    
    const sale = buildSaleFromCart(meta);
    if (!sale) return;

    const items = load("menuItems", []);
    const stockUpdates = [];
    for (const line of sale.items || []) {
        if (!line.itemId) continue;
        const idx = items.findIndex(m => m.id === line.itemId);
        if (idx >= 0) {
            const currentStock = Number(items[idx].stock ?? 0);
            const newStock = (typeof line.stockAfter === "number")
                ? line.stockAfter
                : Math.max(0, currentStock - Number(line.qty || 0));
            items[idx].stock = newStock;
            stockUpdates.push(updateMenuItemStockCloud(line.itemId, newStock));
        }
    }
    save("menuItems", items);

    const sales = load("sales", []);
    sales.push(sale);
    save("sales", sales);

    sendSaleToGoogle(sale);
    await window.saveSaleToCloud(sale);

    try {
        await Promise.all(stockUpdates);
    } catch (e) {
        console.error("Stock update in cloud failed:", e);
    }
    
    save("cart", []);
    state.lastSale = sale;

    renderCart();
    renderMenu();
    renderAdminItems();
    renderSalesReport();
}

// ==== Admin form ====
function loadItemIntoForm(item) {
    itemIdEl.value = item.id;
    itemNameEl.value = item.name;
    itemCategoryEl.value = item.category;
    itemPriceEl.value = item.price;
    itemStockEl.value = item.stock ?? "";
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

    const discount = Number(sale.discount || 0);
    const grandTotal = typeof sale.grandTotal === "number" ? sale.grandTotal : (subtotal - discount);

    receiptSubtotalEl.textContent = formatCurrency(subtotal);
    if (receiptDiscountEl) {
        receiptDiscountEl.textContent = formatCurrency(discount);
    }
    if (receiptGrandTotalEl) {
        receiptGrandTotalEl.textContent = formatCurrency(grandTotal);
    }

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

// ==== CSV export ====
function exportSalesCsv(filename) {
    const sales = load("sales", []);
    if (!sales.length) {
        alert("No sales to export yet.");
        return;
    }

    const header = "Sale Date,Sale Time,Invoice,Customer Name,Customer Phone,Item,Quantity,Unit Price,Line Total,Subtotal,Discount,Grand Total,Stock Before,Stock After,Payment Method,Reference\n";
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

        const subtotal = Number(sale.subtotal || 0);
        const discount = Number(sale.discount || 0);
        const grandTotal = typeof sale.grandTotal === "number" ? sale.grandTotal : (subtotal - discount);

        for (const item of sale.items || []) {
            const itemName = (item.name || "").replace(/"/g, '""');
            const qty = Number(item.qty || 0);
            const unitPrice = Number(item.price || 0);
            const total = unitPrice * qty;

            const stockBefore = (typeof item.stockBefore === "number") ? item.stockBefore : "";
            const stockAfter = (typeof item.stockAfter === "number") ? item.stockAfter : "";

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
                subtotal.toFixed(2),
                discount.toFixed(2),
                grandTotal.toFixed(2),
                stockBefore,
                stockAfter,
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
    let settings = load("settings", { qrSrc: DEFAULT_QR_DATA_URL });
    let qrSrc = qrUrlEl.value.trim();
    if (!qrSrc && qrFileEl.files && qrFileEl.files[0]) {
        qrSrc = await dataUrlFromFile(qrFileEl.files[0]);
    }
    if (qrSrc) settings.qrSrc = qrSrc;
    save("settings", settings);
    try {
        await saveSettingsToCloud(settings);
    } catch (err) {
        console.error("Failed to save settings to cloud:", err);
    }
    alert("Settings saved");
}

// ==== Auth ====
function showAppUI(isAuthenticated) {
    const mainLayout = document.querySelector(".layout");
    const headerControls = document.querySelector(".header-controls");
    
    if (mainLayout) mainLayout.style.display = isAuthenticated ? "grid" : "none";
    if (headerControls) headerControls.style.display = isAuthenticated ? "flex" : "none";

    if (authModal) {
        authModal.style.display = isAuthenticated ? "none" : "flex";
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = authEmail.value;
    const password = authPassword.value;

    try {
        await window.signInWithEmailAndPassword(window.auth, email, password);
    } catch (error) {
        alert("Login failed: " + error.message);
    }
}

// ==== Init ====
async function init() {
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
    itemStockEl = document.getElementById("itemStock");
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
    receiptDiscountEl = document.getElementById("receiptDiscount");
    receiptGrandTotalEl = document.getElementById("receiptGrandTotal");

    discountInputEl = document.getElementById("discountInput");
    rawSubtotalTextEl = document.getElementById("rawSubtotalText");
    
    ensureSeed();

    itemCategoryEl.innerHTML = CATEGORIES
        .map(c => "<option value=\"" + c + "\">" + c + "</option>").join("");

    renderCategories();
    renderMenu();
    renderCart();
    renderAdminItems();
    renderSalesReport();

    payNowBtn.onclick = () => {
        const cart = load("cart", []);
        if (!cart.length) {
            alert("Cart is empty. Add items before payment.");
            return;
        }
        const settings = load("settings", { qrSrc: DEFAULT_QR_DATA_URL });
        qrImageEl.src = settings.qrSrc || DEFAULT_QR_DATA_URL;
        if (paymentMethodSelect) paymentMethodSelect.value = "Cash";
        if (paymentReferenceInput) paymentReferenceInput.value = "";
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
        const customer = {
            name: (customerNameEl.value || "").trim() || "Walk-in Customer",
            phone: (customerPhoneEl.value || "").trim()
        };
        let discount = 0;
        if (discountInputEl) {
            discount = Number(discountInputEl.value || 0);
        }
        const invoiceNumber = generateInvoiceNumber(timestamp);
        await recordSale({ payment, timestamp, invoiceNumber, customer, discount });
        if (discountInputEl) discountInputEl.value = 0;
        qrModal.classList.add("hidden");
    };

    printBillBtn.onclick = () => openPrint();
    printBillTopBtn.onclick = () => openPrint();
    downloadPngBtn.onclick = () => downloadReceiptPng();
    downloadPngTopBtn.onclick = () => downloadReceiptPng();

    clearCartBtn.onclick = () => clearCart();
    clearCartTopBtn.onclick = () => clearCart();

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

    adminToggleBtn.onclick = () => adminPanel.classList.remove("hidden");
    adminCloseBtn.onclick = () => adminPanel.classList.add("hidden");

    itemForm.addEventListener("submit", async e => {
        e.preventDefault();
        const id = itemIdEl.value || String(Date.now() + Math.random());
        const name = itemNameEl.value.trim();
        const category = itemCategoryEl.value;
        const price = Number(itemPriceEl.value);
        const stock = Number(itemStockEl.value || 0);
        let imageSrc = itemImageUrlEl.value.trim();
        if (!imageSrc && itemImageFileEl.files && itemImageFileEl.files[0]) {
            imageSrc = await dataUrlFromFile(itemImageFileEl.files[0]);
        }
        const items = load("menuItems", []);
        const idx = items.findIndex(x => x.id === id);
        const payload = { id, name, category, price, stock, imageSrc };
        if (idx >= 0) items[idx] = payload;
        else items.push(payload);
        save("menuItems", items);

        try {
            await upsertMenuItemCloud(payload);
        } catch (err) {
            console.error("Failed to save item to cloud:", err);
        }

        itemForm.reset();
        itemIdEl.value = "";
        renderAdminItems();
        renderMenu();
    });
    itemFormReset.onclick = () => { itemIdEl.value = ""; };

    settingsForm.addEventListener("submit", saveSettingsFromForm);

    exportMonthlyCsvBtn.onclick = () => exportSalesCsv("sales.csv");
    exportDailyCsvBtn.onclick = () => exportSalesCsv("sales.csv");

    if (discountInputEl) {
        discountInputEl.addEventListener("input", () => {
            renderCart();
            renderMenu();
        });
    }

    window.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            if (!qrModal.classList.contains("hidden")) qrModal.classList.add("hidden");
            if (!adminPanel.classList.contains("hidden")) adminPanel.classList.add("hidden");
        }
    });
}

// DOM ready
document.addEventListener("DOMContentLoaded", () => {
    authModal = document.getElementById("authModal");
    authForm = document.getElementById("authForm");
    authEmail = document.getElementById("authEmail");
    authPassword = document.getElementById("authPassword");

    if (authForm) authForm.addEventListener("submit", handleLogin);

    if (window.onAuthStateChanged) {
        window.onAuthStateChanged(window.auth, async (user) => {
            showAppUI(user != null); 
            
            if (user) {
                await init(); 

                if (window.loadRecentSalesFromCloud) {
                    const cloudSales = await window.loadRecentSalesFromCloud();
                    save("sales", cloudSales); 
                    renderSalesReport();
                }

                await syncInventoryFromCloud();
                await syncSettingsFromCloud();
                renderMenu();
                renderAdminItems();
            }
        });
    } else {
        init(); 
        showAppUI(true); 
    }
});
