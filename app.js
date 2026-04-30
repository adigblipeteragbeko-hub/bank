const STORAGE_KEYS = {
  USERS: "bank_users",
  TX: "bank_transactions",
  SESSION: "bank_session"
};

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "balance", label: "Balance" },
  { key: "transfer", label: "Transfer" },
  { key: "history", label: "Transaction History" },
  { key: "profile", label: "Profile" },
  { key: "admin", label: "Admin Panel", adminOnly: true }
];

let state = {
  users: [],
  transactions: [],
  sessionUserId: null,
  activeTab: "dashboard"
};

const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const tabsEl = document.getElementById("tabs");
const contentEl = document.getElementById("content");
const authActions = document.getElementById("auth-actions");
const logoutBtn = document.getElementById("logout-btn");

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function loadState() {
  const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || "null");
  const tx = JSON.parse(localStorage.getItem(STORAGE_KEYS.TX) || "null");
  const session = localStorage.getItem(STORAGE_KEYS.SESSION);

  if (!users || users.length === 0) {
    const seeded = [
      {
        id: uid("usr"),
        fullName: "System Admin",
        email: "admin@bank.local",
        password: "admin123",
        role: "admin",
        balance: 5000,
        createdAt: nowIso()
      }
    ];
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(seeded));
    state.users = seeded;
  } else {
    state.users = users;
  }

  state.transactions = tx || [];
  state.sessionUserId = session;
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(state.users));
  localStorage.setItem(STORAGE_KEYS.TX, JSON.stringify(state.transactions));
}

function currentUser() {
  return state.users.find((u) => u.id === state.sessionUserId) || null;
}

function login(userId) {
  state.sessionUserId = userId;
  localStorage.setItem(STORAGE_KEYS.SESSION, userId);
  state.activeTab = "dashboard";
  render();
}

function logout() {
  state.sessionUserId = null;
  localStorage.removeItem(STORAGE_KEYS.SESSION);
  render();
}

function renderAuth() {
  authView.classList.remove("hidden");
  appView.classList.add("hidden");
  authActions.classList.add("hidden");

  authView.innerHTML = `
    <h2>Welcome</h2>
    <p class="muted">Create an account or sign in.</p>
    <div class="row">
      <button class="btn" id="show-login">Login</button>
      <button class="btn secondary" id="show-register">Register</button>
    </div>
    <div id="auth-form" style="margin-top: 14px;"></div>
    <p class="muted" style="margin-top: 16px;">Seeded admin: admin@bank.local / admin123</p>
  `;

  const formHost = document.getElementById("auth-form");

  const showLogin = () => {
    formHost.innerHTML = `
      <form id="login-form" class="form-grid">
        <div><label>Email</label><input type="email" name="email" required /></div>
        <div><label>Password</label><input type="password" name="password" required /></div>
        <button class="btn" type="submit">Login</button>
        <div id="login-msg"></div>
      </form>
    `;

    document.getElementById("login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const email = String(data.get("email")).toLowerCase().trim();
      const password = String(data.get("password"));
      const user = state.users.find((u) => u.email.toLowerCase() === email && u.password === password);
      const msg = document.getElementById("login-msg");
      if (!user) {
        msg.className = "error";
        msg.textContent = "Invalid login credentials.";
        return;
      }
      login(user.id);
    });
  };

  const showRegister = () => {
    formHost.innerHTML = `
      <form id="register-form" class="form-grid">
        <div><label>Full Name</label><input name="fullName" required /></div>
        <div><label>Email</label><input type="email" name="email" required /></div>
        <div><label>Password</label><input type="password" name="password" required minlength="6" /></div>
        <button class="btn secondary" type="submit">Create Account</button>
        <div id="register-msg"></div>
      </form>
    `;

    document.getElementById("register-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const fullName = String(data.get("fullName")).trim();
      const email = String(data.get("email")).trim().toLowerCase();
      const password = String(data.get("password"));
      const msg = document.getElementById("register-msg");

      if (state.users.some((u) => u.email.toLowerCase() === email)) {
        msg.className = "error";
        msg.textContent = "Email is already registered.";
        return;
      }

      const newUser = {
        id: uid("usr"),
        fullName,
        email,
        password,
        role: "user",
        balance: 1000,
        createdAt: nowIso()
      };

      state.users.push(newUser);
      persist();
      msg.className = "notice";
      msg.textContent = "Account created. Logging you in...";
      setTimeout(() => login(newUser.id), 500);
    });
  };

  document.getElementById("show-login").addEventListener("click", showLogin);
  document.getElementById("show-register").addEventListener("click", showRegister);
  showLogin();
}

function dashboardView(user) {
  const recent = state.transactions
    .filter((t) => t.fromUserId === user.id || t.toUserId === user.id)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  return `
    <h2>Hi, ${user.fullName}</h2>
    <p class="muted">Role: ${user.role}</p>
    <p class="balance">${money(user.balance)}</p>
    <p class="muted">Available balance</p>
    <h3 style="margin-top: 18px;">Recent activity</h3>
    ${recent.length === 0 ? "<p class='muted'>No transactions yet.</p>" : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Counterparty</th></tr></thead>
          <tbody>
            ${recent.map((t) => {
              const isSender = t.fromUserId === user.id;
              const cp = state.users.find((u) => u.id === (isSender ? t.toUserId : t.fromUserId));
              return `<tr>
                <td>${new Date(t.createdAt).toLocaleString()}</td>
                <td>${isSender ? "Sent" : "Received"}</td>
                <td>${money(t.amount)}</td>
                <td>${cp ? cp.email : "Unknown"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function balanceView(user) {
  return `
    <h2>Balance</h2>
    <p class="balance">${money(user.balance)}</p>
    <p class="muted">This reflects all transfers processed in the system.</p>
  `;
}

function transferView(user) {
  const options = state.users
    .filter((u) => u.id !== user.id)
    .map((u) => `<option value="${u.id}">${u.fullName} (${u.email})</option>`)
    .join("");

  return `
    <h2>Transfer</h2>
    ${options ? `
      <form id="transfer-form" class="form-grid">
        <div>
          <label>Recipient</label>
          <select name="toUserId" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
            ${options}
          </select>
        </div>
        <div>
          <label>Amount</label>
          <input type="number" min="0.01" step="0.01" name="amount" required />
        </div>
        <button class="btn" type="submit">Send Transfer</button>
        <div id="transfer-msg"></div>
      </form>
    ` : `<p class="muted">No recipient available yet. Ask someone to register first.</p>`}
  `;
}

function historyView(user) {
  const list = state.transactions
    .filter((t) => t.fromUserId === user.id || t.toUserId === user.id)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return `
    <h2>Transaction History</h2>
    ${list.length === 0 ? "<p class='muted'>No transactions yet.</p>" : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Direction</th><th>Amount</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            ${list.map((t) => {
              const from = state.users.find((u) => u.id === t.fromUserId);
              const to = state.users.find((u) => u.id === t.toUserId);
              const direction = t.fromUserId === user.id ? "Debit" : "Credit";
              return `<tr>
                <td>${new Date(t.createdAt).toLocaleString()}</td>
                <td>${direction}</td>
                <td>${money(t.amount)}</td>
                <td>${from ? from.email : "Unknown"}</td>
                <td>${to ? to.email : "Unknown"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function profileView(user) {
  return `
    <h2>Profile</h2>
    <form id="profile-form" class="form-grid">
      <div><label>Full Name</label><input name="fullName" value="${user.fullName}" required /></div>
      <div><label>Email</label><input type="email" name="email" value="${user.email}" required /></div>
      <div><label>New Password (optional)</label><input type="password" name="password" minlength="6" /></div>
      <button class="btn secondary" type="submit">Save Profile</button>
      <div id="profile-msg"></div>
    </form>
  `;
}

function adminView() {
  return `
    <h2>Admin Panel</h2>
    <p class="muted">Manage users and inspect all transfers.</p>

    <h3>Users</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Balance</th></tr></thead>
        <tbody>
          ${state.users.map((u) => `<tr><td>${u.fullName}</td><td>${u.email}</td><td>${u.role}</td><td>${money(u.balance)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>

    <h3 style="margin-top:16px;">Adjust User Balance</h3>
    <form id="admin-adjust-form" class="form-grid">
      <div>
        <label>User</label>
        <select name="userId" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
          ${state.users.map((u) => `<option value="${u.id}">${u.fullName} (${u.email})</option>`).join("")}
        </select>
      </div>
      <div><label>New Balance</label><input type="number" name="balance" step="0.01" min="0" required /></div>
      <button class="btn" type="submit">Update Balance</button>
      <div id="admin-msg"></div>
    </form>

    <h3 style="margin-top:16px;">All Transactions</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>From</th><th>To</th><th>Amount</th></tr></thead>
        <tbody>
          ${state.transactions.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((t) => {
            const from = state.users.find((u) => u.id === t.fromUserId);
            const to = state.users.find((u) => u.id === t.toUserId);
            return `<tr><td>${new Date(t.createdAt).toLocaleString()}</td><td>${from ? from.email : "Unknown"}</td><td>${to ? to.email : "Unknown"}</td><td>${money(t.amount)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindEvents(user) {
  const transferForm = document.getElementById("transfer-form");
  if (transferForm) {
    transferForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const toUserId = String(data.get("toUserId"));
      const amount = Number(data.get("amount"));
      const msg = document.getElementById("transfer-msg");
      const fromUser = state.users.find((u) => u.id === user.id);
      const toUser = state.users.find((u) => u.id === toUserId);

      if (!toUser) {
        msg.className = "error";
        msg.textContent = "Recipient not found.";
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        msg.className = "error";
        msg.textContent = "Enter a valid transfer amount.";
        return;
      }
      if (fromUser.balance < amount) {
        msg.className = "error";
        msg.textContent = "Insufficient balance.";
        return;
      }

      fromUser.balance -= amount;
      toUser.balance += amount;

      state.transactions.push({
        id: uid("tx"),
        fromUserId: fromUser.id,
        toUserId: toUser.id,
        amount,
        createdAt: nowIso()
      });

      persist();
      msg.className = "notice";
      msg.textContent = `Transferred ${money(amount)} to ${toUser.email}.`;
      e.target.reset();
      render();
    });
  }

  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const fullName = String(data.get("fullName")).trim();
      const email = String(data.get("email")).trim().toLowerCase();
      const password = String(data.get("password") || "").trim();
      const msg = document.getElementById("profile-msg");

      const duplicate = state.users.find((u) => u.email.toLowerCase() === email && u.id !== user.id);
      if (duplicate) {
        msg.className = "error";
        msg.textContent = "Email already used by another account.";
        return;
      }

      const me = state.users.find((u) => u.id === user.id);
      me.fullName = fullName;
      me.email = email;
      if (password) me.password = password;
      persist();
      msg.className = "notice";
      msg.textContent = "Profile updated successfully.";
      render();
    });
  }

  const adminAdjustForm = document.getElementById("admin-adjust-form");
  if (adminAdjustForm) {
    adminAdjustForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const userId = String(data.get("userId"));
      const balance = Number(data.get("balance"));
      const msg = document.getElementById("admin-msg");

      if (!Number.isFinite(balance) || balance < 0) {
        msg.className = "error";
        msg.textContent = "Balance must be a non-negative number.";
        return;
      }

      const target = state.users.find((u) => u.id === userId);
      if (!target) {
        msg.className = "error";
        msg.textContent = "User not found.";
        return;
      }

      target.balance = balance;
      persist();
      msg.className = "notice";
      msg.textContent = `Balance updated for ${target.email}.`;
      render();
    });
  }
}

function renderApp() {
  const user = currentUser();
  if (!user) {
    renderAuth();
    return;
  }

  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  authActions.classList.remove("hidden");

  const availableTabs = TABS.filter((t) => !t.adminOnly || user.role === "admin");
  if (!availableTabs.some((t) => t.key === state.activeTab)) {
    state.activeTab = "dashboard";
  }

  tabsEl.innerHTML = availableTabs
    .map((t) => `<button class="tab ${t.key === state.activeTab ? "active" : ""}" data-tab="${t.key}">${t.label}</button>`)
    .join("");

  tabsEl.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      render();
    });
  });

  if (state.activeTab === "dashboard") contentEl.innerHTML = dashboardView(user);
  if (state.activeTab === "balance") contentEl.innerHTML = balanceView(user);
  if (state.activeTab === "transfer") contentEl.innerHTML = transferView(user);
  if (state.activeTab === "history") contentEl.innerHTML = historyView(user);
  if (state.activeTab === "profile") contentEl.innerHTML = profileView(user);
  if (state.activeTab === "admin") contentEl.innerHTML = adminView();

  bindEvents(user);
}

function render() {
  if (currentUser()) {
    renderApp();
  } else {
    renderAuth();
  }
}

logoutBtn.addEventListener("click", logout);

loadState();
render();
