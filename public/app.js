const API_BASE = "/api";
const TOKEN_KEY = "bank_token";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "balance", label: "Balance" },
  { key: "transfer", label: "Transfer" },
  { key: "history", label: "Transaction History" },
  { key: "profile", label: "Profile" },
  { key: "admin", label: "Admin Panel", adminOnly: true }
];

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  users: [],
  transactions: [],
  adminUsers: [],
  adminTransactions: [],
  activeTab: "dashboard"
};

const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const tabsEl = document.getElementById("tabs");
const contentEl = document.getElementById("content");
const authActions = document.getElementById("auth-actions");
const logoutBtn = document.getElementById("logout-btn");

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const fallback = text && !text.trim().startsWith("<") ? text.trim() : "";
    throw new Error(data.error || fallback || `Request failed (${res.status}).`);
  }

  return data;
}

function normalizeStatus(user) {
  if (!user) return "active";
  if (user.accountStatus) return user.accountStatus;
  if (typeof user.isActive === "boolean") return user.isActive ? "active" : "blocked";
  return "active";
}

function normalizeUser(user) {
  if (!user) return user;
  return { ...user, accountStatus: normalizeStatus(user) };
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  render();
}

async function loadAppData() {
  const [me, users, transactions] = await Promise.all([
    api("/me"),
    api("/users"),
    api("/transactions")
  ]);

  state.user = me.user;
  state.user = normalizeUser(state.user);
  state.users = users.users;
  state.transactions = transactions.transactions;

  if (state.user.role === "admin") {
    const [adminUsers, adminTx] = await Promise.all([
      api("/admin/users"),
      api("/admin/transactions")
    ]);
    state.adminUsers = adminUsers.users.map(normalizeUser);
    state.adminTransactions = adminTx.transactions;
  }
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

    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("login-msg");
      msg.textContent = "";

      try {
        const result = await api("/auth/login", {
          method: "POST",
          body: {
            email: String(data.get("email") || "").trim(),
            password: String(data.get("password") || "")
          }
        });

        state.token = result.token;
        localStorage.setItem(TOKEN_KEY, result.token);
        state.activeTab = "dashboard";
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  };

  const showRegister = () => {
    formHost.innerHTML = `
      <form id="register-form" class="form-grid">
        <div><label>Full Name</label><input name="fullName" required /></div>
        <div><label>Email</label><input type="email" name="email" required /></div>
        <div><label>Password</label><input type="password" name="password" required minlength="6" /></div>
        <button class="btn secondary" type="submit">Send Verification Code</button>
        <div id="register-msg"></div>
      </form>
      <form id="verify-form" class="form-grid" style="margin-top:12px;">
        <div><label>Email</label><input type="email" name="email" required /></div>
        <div><label>Verification Code</label><input name="code" required /></div>
        <button class="btn" type="submit">Verify & Create Account</button>
        <div id="verify-msg"></div>
      </form>
    `;

    document.getElementById("register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("register-msg");
      msg.textContent = "";

      try {
        const email = String(data.get("email") || "").trim();
        await api("/auth/register", {
          method: "POST",
          body: {
            fullName: String(data.get("fullName") || "").trim(),
            email,
            password: String(data.get("password") || "")
          }
        });

        msg.className = "notice";
        msg.textContent = "Verification code sent. Check your email, then verify below.";
        document.querySelector("#verify-form input[name='email']").value = email;
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });

    document.getElementById("verify-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("verify-msg");
      msg.textContent = "";

      try {
        const result = await api("/auth/verify", {
          method: "POST",
          body: {
            email: String(data.get("email") || "").trim(),
            code: String(data.get("code") || "").trim()
          }
        });

        state.token = result.token;
        localStorage.setItem(TOKEN_KEY, result.token);
        state.activeTab = "dashboard";
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  };

  document.getElementById("show-login").addEventListener("click", showLogin);
  document.getElementById("show-register").addEventListener("click", showRegister);
  showLogin();
}

function dashboardView() {
  const recent = state.transactions.slice(0, 5);
  const statusNotice = state.user.accountStatus !== "active"
    ? `<p class="error">Account status: ${state.user.accountStatus}. Outgoing operations are restricted.</p>`
    : "";

  return `
    <h2>Hi, ${state.user.fullName}</h2>
    <p class="muted">Role: ${state.user.role}</p>
    ${statusNotice}
    <p class="balance">${money(state.user.balance)}</p>
    <p class="muted">Available balance</p>
    <h3 style="margin-top: 18px;">Recent activity</h3>
    ${recent.length === 0 ? "<p class='muted'>No transactions yet.</p>" : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Counterparty</th></tr></thead>
          <tbody>
            ${recent.map((t) => {
              const isSender = t.fromUserId === state.user.id;
              return `<tr>
                <td>${new Date(t.createdAt).toLocaleString()}</td>
                <td>${isSender ? "Sent" : "Received"}</td>
                <td>${money(t.amount)}</td>
                <td>${isSender ? t.toEmail : t.fromEmail}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function balanceView() {
  return `
    <h2>Balance</h2>
    <p class="balance">${money(state.user.balance)}</p>
    <p class="muted">This reflects all transfers processed in the system.</p>
  `;
}

function transferView() {
  if (state.user.accountStatus !== "active") {
    return `
      <h2>Transfer</h2>
      <p class="error">Transfers are unavailable while your account is ${state.user.accountStatus}.</p>
    `;
  }
  const options = state.users
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

function historyView() {
  return `
    <h2>Transaction History</h2>
    ${state.transactions.length === 0 ? "<p class='muted'>No transactions yet.</p>" : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Direction</th><th>Amount</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            ${state.transactions.map((t) => {
              const direction = t.fromUserId === state.user.id ? "Debit" : "Credit";
              return `<tr>
                <td>${new Date(t.createdAt).toLocaleString()}</td>
                <td>${direction}</td>
                <td>${money(t.amount)}</td>
                <td>${t.fromEmail}</td>
                <td>${t.toEmail}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function profileView() {
  return `
    <h2>Profile</h2>
    <form id="profile-form" class="form-grid">
      <div><label>Full Name</label><input name="fullName" value="${state.user.fullName}" required /></div>
      <div><label>Email</label><input type="email" name="email" value="${state.user.email}" required /></div>
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
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Account Status</th><th>Balance</th></tr></thead>
        <tbody>
          ${state.adminUsers.map((u) => `<tr><td>${u.fullName}</td><td>${u.email}</td><td>${u.role}</td><td>${u.accountStatus}</td><td>${money(u.balance)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>

    <h3 style="margin-top:16px;">Adjust User Balance</h3>
    <form id="admin-adjust-form" class="form-grid">
      <div>
        <label>User</label>
        <select name="userId" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
          ${state.adminUsers.map((u) => `<option value="${u.id}">${u.fullName} (${u.email})</option>`).join("")}
        </select>
      </div>
      <div><label>New Balance</label><input type="number" name="balance" step="0.01" min="0" required /></div>
      <button class="btn" type="submit">Update Balance</button>
      <div id="admin-msg"></div>
    </form>

    <h3 style="margin-top:16px;">Change User Role</h3>
    <form id="admin-role-form" class="form-grid">
      <div>
        <label>User</label>
        <select name="userId" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
          ${state.adminUsers.map((u) => `<option value="${u.id}">${u.fullName} (${u.email})</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Role</label>
        <select name="role" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <button class="btn secondary" type="submit">Update Role</button>
      <div id="admin-role-msg"></div>
    </form>

    <h3 style="margin-top:16px;">Account Controls (Freeze / Block)</h3>
    <form id="admin-status-form" class="form-grid">
      <div>
        <label>User</label>
        <select name="userId" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
          ${state.adminUsers.map((u) => `<option value="${u.id}">${u.fullName} (${u.email})</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Account Status</label>
        <select name="accountStatus" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
          <option value="active">active</option>
          <option value="frozen">frozen</option>
          <option value="blocked">blocked</option>
        </select>
      </div>
      <button class="btn secondary" type="submit">Update Status</button>
      <div id="admin-status-msg"></div>
    </form>

    <h3 style="margin-top:16px;">Delete User</h3>
    <form id="admin-delete-form" class="form-grid">
      <div>
        <label>User</label>
        <select name="userId" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px;">
          ${state.adminUsers.map((u) => `<option value="${u.id}">${u.fullName} (${u.email})</option>`).join("")}
        </select>
      </div>
      <button class="btn danger" type="submit">Delete User</button>
      <div id="admin-delete-msg"></div>
    </form>

    <h3 style="margin-top:16px;">All Transactions</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>From</th><th>To</th><th>Amount</th></tr></thead>
        <tbody>
          ${state.adminTransactions.map((t) => `<tr><td>${new Date(t.createdAt).toLocaleString()}</td><td>${t.fromEmail}</td><td>${t.toEmail}</td><td>${money(t.amount)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function bindEvents() {
  const transferForm = document.getElementById("transfer-form");
  if (transferForm) {
    transferForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("transfer-msg");
      msg.textContent = "";

      try {
        await api("/transfers", {
          method: "POST",
          body: {
            toUserId: String(data.get("toUserId") || ""),
            amount: Number(data.get("amount"))
          }
        });
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  }

  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("profile-msg");
      msg.textContent = "";

      try {
        await api("/me", {
          method: "PUT",
          body: {
            fullName: String(data.get("fullName") || "").trim(),
            email: String(data.get("email") || "").trim(),
            password: String(data.get("password") || "")
          }
        });
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  }

  const adminAdjustForm = document.getElementById("admin-adjust-form");
  if (adminAdjustForm) {
    adminAdjustForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("admin-msg");
      msg.textContent = "";

      try {
        await api(`/admin/users/${String(data.get("userId") || "")}/balance`, {
          method: "PUT",
          body: { balance: Number(data.get("balance")) }
        });
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  }

  const adminRoleForm = document.getElementById("admin-role-form");
  if (adminRoleForm) {
    adminRoleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("admin-role-msg");
      msg.textContent = "";
      try {
        await api(`/admin/users/${String(data.get("userId") || "")}/role`, {
          method: "PUT",
          body: { role: String(data.get("role") || "") }
        });
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  }

  const adminStatusForm = document.getElementById("admin-status-form");
  if (adminStatusForm) {
    adminStatusForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("admin-status-msg");
      msg.textContent = "";
      try {
        await api(`/admin/users/${String(data.get("userId") || "")}/status`, {
          method: "PUT",
          body: { accountStatus: String(data.get("accountStatus") || "") }
        });
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  }

  const adminDeleteForm = document.getElementById("admin-delete-form");
  if (adminDeleteForm) {
    adminDeleteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const msg = document.getElementById("admin-delete-msg");
      msg.textContent = "";
      if (!window.confirm("Are you sure you want to permanently delete this user?")) return;
      try {
        await api(`/admin/users/${String(data.get("userId") || "")}`, { method: "DELETE" });
        await render();
      } catch (err) {
        msg.className = "error";
        msg.textContent = err.message;
      }
    });
  }
}

async function renderApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  authActions.classList.remove("hidden");

  const availableTabs = TABS.filter((t) => !t.adminOnly || state.user.role === "admin");
  if (!availableTabs.some((t) => t.key === state.activeTab)) state.activeTab = "dashboard";

  tabsEl.innerHTML = availableTabs
    .map((t) => `<button class="tab ${t.key === state.activeTab ? "active" : ""}" data-tab="${t.key}">${t.label}</button>`)
    .join("");

  tabsEl.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.activeTab = btn.dataset.tab;
      await render();
    });
  });

  if (state.activeTab === "dashboard") contentEl.innerHTML = dashboardView();
  if (state.activeTab === "balance") contentEl.innerHTML = balanceView();
  if (state.activeTab === "transfer") contentEl.innerHTML = transferView();
  if (state.activeTab === "history") contentEl.innerHTML = historyView();
  if (state.activeTab === "profile") contentEl.innerHTML = profileView();
  if (state.activeTab === "admin") contentEl.innerHTML = adminView();

  await bindEvents();
}

async function render() {
  if (!state.token) {
    renderAuth();
    return;
  }

  try {
    await loadAppData();
    await renderApp();
  } catch {
    logout();
  }
}

logoutBtn.addEventListener("click", logout);
render();
