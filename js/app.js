// Taskbook — Student Task Organizer
// Firebase Authentication (email/password + Google) and Cloud Firestore.
//
// Data layout in Firestore:
//   users/{uid}                 -> { prefs: {...}, updatedAt }        (account preferences)
//   users/{uid}/tasks/{taskId}  -> one task
// Task fields: title, subject, due (YYYY-MM-DD), priority, done, createdAt,
//              completedAt (ms or null), steps [{text, done}], focusMins (number)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, deleteUser,
  updateProfile, sendEmailVerification, EmailAuthProvider, reauthenticateWithCredential,
  reauthenticateWithPopup, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, writeBatch, getDocs, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const PRI = { high: 0, medium: 1, low: 2 };
const FILTERS = [["all", "All"], ["today", "Due today"], ["upcoming", "Upcoming"], ["overdue", "Overdue"], ["done", "Done"]];
const MAX_STEPS = 30;
const DEFAULT_PREFS = { dailyGoal: 3, focusMin: 25, breakMin: 5, sound: true, defaultSort: "due", hideDone: false };

let tasks = [];
let user = null;
let prefs = { ...DEFAULT_PREFS };
let unsubTasks = null, unsubPrefs = null;
let signUpMode = false;
let sortTouched = false;
const state = { filter: "all", q: "", subj: "", sort: "due", day: "", editing: null, confirm: null, open: new Set() };

/* ---------------- helpers ---------------- */
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => iso(new Date());
const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return iso(d); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tasksCol = () => collection(db, "users", user.uid, "tasks");
const taskRef = (id) => doc(db, "users", user.uid, "tasks", id);
const userRef = () => doc(db, "users", user.uid);
const firstName = () => (user?.displayName || "").trim().split(/\s+/)[0] || "";
const hasPassword = () => !!user?.providerData.some((p) => p.providerId === "password");
const hasGoogle = () => !!user?.providerData.some((p) => p.providerId === "google.com");

function initials() {
  const name = (user?.displayName || "").trim();
  if (name) return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (user?.email || "?")[0].toUpperCase();
}

function toast(msg, action) {
  const t = $("toast"), btn = $("toast-btn");
  $("toast-msg").textContent = msg;
  btn.hidden = !action;
  btn.onclick = action ? () => { t.classList.remove("show"); action.fn(); } : null;
  if (action) btn.textContent = action.label;
  t.classList.toggle("has-action", !!action);
  t.classList.add("show");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("show"), action ? 6000 : 2800);
}

function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function friendlyError(err) {
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "No account uses this email. Create one instead.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/popup-closed-by-user": "The Google window was closed before finishing.",
    "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
    "auth/unauthorized-domain": `This address (${location.hostname}) isn't allowed in Firebase yet. In Firebase, go to Authentication → Settings → Authorized domains and add exactly: ${location.hostname}`,
    "auth/operation-not-allowed": "This sign-in method is turned off. In Firebase, go to Authentication → Sign-in method and enable it (Email/Password or Google).",
    "auth/cancelled-popup-request": "Another sign-in window was already open. Please try again.",
    "auth/internal-error": "Firebase couldn't finish signing in. Check that Google sign-in is enabled and your config in js/firebase-config.js is correct.",
    "auth/network-request-failed": "No internet connection. Check your connection and try again.",
    "auth/requires-recent-login": "For your security, sign out and sign in again, then retry.",
    "auth/user-mismatch": "That Google account isn't the one you're signed in with.",
    "permission-denied": "You don't have permission to do that. Check the Firestore security rules."
  };
  if (String(err?.code).startsWith("auth/api-key-not-valid") || String(err?.code) === "auth/invalid-api-key")
    return "Firebase isn't set up yet. Paste your project's config into js/firebase-config.js.";
  console.error(err);
  return map[err?.code] || `Something went wrong${err?.code ? ` (${err.code})` : ""}. Please try again.`;
}

/* ---------------- views and routing ---------------- */
// #tasks (default) and #account are pages inside index.html.
function route() {
  const page = location.hash === "#account" ? "account" : "tasks";
  if (!user) return;
  $("view-app").hidden = page !== "tasks";
  $("view-account").hidden = page !== "account";
  $("nav-tasks").toggleAttribute("aria-current", page === "tasks");
  $("nav-account").toggleAttribute("aria-current", page === "account");
  if (page === "tasks") $("nav-tasks").setAttribute("aria-current", "page");
  else { $("nav-account").setAttribute("aria-current", "page"); renderAccount(true); }
  document.title = page === "account" ? "My Account — Taskbook" : "Taskbook — Student Task Organizer";
  baseTitle = document.title;
}
window.addEventListener("hashchange", () => { state.confirm = null; route(); window.scrollTo(0, 0); });

function show(view) {
  $("view-loading").hidden = view !== "loading";
  $("view-auth").hidden = view !== "auth";
  $("who").hidden = view !== "app";
  if (view !== "app") { $("view-app").hidden = true; $("view-account").hidden = true; }
  else route();
}

/* Offline notice */
function updateOnline() { $("offline").hidden = navigator.onLine; }
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
updateOnline();

/* Show / hide password buttons */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pw]");
  if (!b) return;
  const input = b.parentElement.querySelector("input");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  b.textContent = showing ? "Show" : "Hide";
  b.setAttribute("aria-label", showing ? "Show password" : "Hide password");
});

/* ---------------- auth ---------------- */
function setAuthMode(up) {
  signUpMode = up;
  $("auth-title").textContent = up ? "Create your Taskbook account" : "Sign in to Taskbook";
  $("auth-sub").textContent = up ? "It's free and takes less than a minute." : "Welcome back! Enter your details to continue.";
  $("auth-submit").textContent = up ? "Create account" : "Sign in";
  $("switch-text").textContent = up ? "Already have an account?" : "New to Taskbook?";
  $("btn-switch").textContent = up ? "Sign in" : "Create an account";
  $("btn-reset").hidden = up;
  $("name-field").hidden = !up;
  $("auth-password").autocomplete = up ? "new-password" : "current-password";
  authMsg();
}
function authMsg(error = "", info = "") {
  $("auth-error").hidden = !error; $("auth-error").textContent = error;
  $("auth-info").hidden = !info; $("auth-info").textContent = info;
}

$("btn-switch").addEventListener("click", () => setAuthMode(!signUpMode));

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const pw = $("auth-password").value;
  if (!email || !pw) return authMsg("Enter your email and password.");
  $("auth-submit").disabled = true;
  try {
    if (signUpMode) {
      const name = $("auth-name").value.trim();
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      if (name) await updateProfile(cred.user, { displayName: name });
      sendEmailVerification(cred.user).catch(() => {});
      refreshUserUI();
      render();
      toast("Welcome to Taskbook! We sent a link to confirm your email.");
    } else {
      await signInWithEmailAndPassword(auth, email, pw);
    }
    $("auth-password").value = "";
  } catch (err) {
    authMsg(friendlyError(err));
  } finally {
    $("auth-submit").disabled = false;
  }
});

$("btn-google").addEventListener("click", async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { authMsg(friendlyError(err)); }
});

$("btn-reset").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  if (!email) return authMsg("Type your email above, then click “Forgot your password?” again.");
  try {
    await sendPasswordResetEmail(auth, email);
    authMsg("", "If an account uses that email, a password reset link is on its way.");
  } catch (err) { authMsg(friendlyError(err)); }
});

const doSignOut = () => { closeTimer(); signOut(auth); };
$("btn-signout").addEventListener("click", doSignOut);
$("btn-signout-2").addEventListener("click", doSignOut);

onAuthStateChanged(auth, (u) => {
  if (unsubTasks) { unsubTasks(); unsubTasks = null; }
  if (unsubPrefs) { unsubPrefs(); unsubPrefs = null; }
  user = u;
  tasks = [];
  prefs = { ...DEFAULT_PREFS };
  sortTouched = false;
  Object.assign(state, { filter: "all", q: "", subj: "", sort: "due", day: "", editing: null, confirm: null });
  state.open.clear();
  $("search").value = "";
  if (!u) { closeTimer(); show("auth"); setAuthMode(false); return; }
  refreshUserUI();
  show("app");
  render();

  // Live sync: changes on another device appear here automatically.
  unsubTasks = onSnapshot(tasksCol(), (snap) => {
    tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (state.editing && !tasks.some((t) => t.id === state.editing)) state.editing = null;
    render();
    renderTimer();
    if (!$("view-account").hidden) renderAccount(false);
  }, (err) => toast(friendlyError(err)));

  unsubPrefs = onSnapshot(userRef(), (snap) => {
    prefs = { ...DEFAULT_PREFS, ...(snap.exists() ? snap.data().prefs : {}) };
    if (!sortTouched) { state.sort = prefs.defaultSort; $("sort").value = state.sort; }
    if (!timer.running && timer.left === timer.lenMin * 60) setMode(timer.mode);
    render();
    if (!$("view-account").hidden) renderAccount(true);
  }, () => { /* preferences are optional; defaults keep working */ });
});

function refreshUserUI() {
  if (!user) return;
  $("who-avatar").textContent = initials();
  $("who-name").textContent = user.displayName || "Student";
  $("who-email").textContent = user.email || "";
}

/* ---------------- task logic ---------------- */
function dueInfo(t) {
  if (!t.due) return { cls: "", txt: "No due date", diff: null };
  const d = new Date(t.due + "T00:00");
  const n = new Date(today() + "T00:00");
  const diff = Math.round((d - n) / 86400000);
  const nice = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (t.done) return { cls: "fin", txt: "Done · " + nice, diff };
  if (diff < 0) return { cls: "late", txt: (-diff) + "d overdue · " + nice, diff };
  if (diff === 0) return { cls: "soon", txt: "Due today", diff };
  if (diff === 1) return { cls: "soon", txt: "Due tomorrow", diff };
  if (diff <= 3) return { cls: "soon", txt: "In " + diff + " days · " + nice, diff };
  return { cls: "", txt: nice, diff };
}

function matches(t) {
  const td = today();
  if (state.day && t.due !== state.day) return false;
  if (state.filter === "done" && !t.done) return false;
  if (!["done", "all"].includes(state.filter) && t.done) return false;
  if (state.filter === "all" && prefs.hideDone && t.done) return false;
  if (state.filter === "today" && t.due !== td) return false;
  if (state.filter === "upcoming" && !(t.due && t.due > td)) return false;
  if (state.filter === "overdue" && !(t.due && t.due < td)) return false;
  if (state.subj && t.subject !== state.subj) return false;
  const q = state.q.trim().toLowerCase();
  if (q) {
    const hay = [t.title, t.subject, ...(t.steps || []).map((s) => s.text)].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const created = (t) => t.createdAt?.toMillis ? t.createdAt.toMillis() : Date.now();
function sorter(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  if (state.sort === "pri") return PRI[a.priority] - PRI[b.priority] || (a.due || "9").localeCompare(b.due || "9");
  if (state.sort === "new") return created(b) - created(a);
  return (a.due || "9999").localeCompare(b.due || "9999") || PRI[a.priority] - PRI[b.priority];
}

/* Streaks and stats, calculated from completion dates. */
function stats() {
  const doneTasks = tasks.filter((t) => t.done && t.completedAt);
  const days = new Set(doneTasks.map((t) => iso(new Date(t.completedAt))));
  // current streak: ends today, or yesterday if nothing is finished yet today
  const d = new Date();
  if (!days.has(iso(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(iso(d))) { streak++; d.setDate(d.getDate() - 1); }
  // best streak
  let best = 0, run = 0, prev = null;
  [...days].sort().forEach((k) => {
    run = prev && addDays(1, new Date(prev + "T00:00")) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  });
  const weekAgo = Date.now() - 7 * 86400000;
  const subjCount = {};
  tasks.forEach((t) => { if (t.subject) subjCount[t.subject] = (subjCount[t.subject] || 0) + 1; });
  const topSubject = Object.entries(subjCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return {
    streak, best: Math.max(best, streak),
    week: doneTasks.filter((t) => t.completedAt >= weekAgo).length,
    doneToday: doneTasks.filter((t) => iso(new Date(t.completedAt)) === today()).length,
    focus: tasks.reduce((sum, t) => sum + (t.focusMins || 0), 0),
    total: tasks.length,
    completed: tasks.filter((t) => t.done).length,
    topSubject
  };
}
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)} min`);

function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return firstName() ? `${part}, ${firstName()}` : part;
}

/* ---------------- rendering: tasks page ---------------- */
function render() {
  if (!user) return;
  const td = today();
  const open = tasks.filter((t) => !t.done);
  const done = tasks.length - open.length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  $("greeting").textContent = greeting();
  $("counts").innerHTML =
    `<span><b>${open.length}</b> to do</span>` +
    `<span><b>${open.filter((t) => t.due === td).length}</b> due today</span>` +
    `<span><b>${open.filter((t) => t.due && t.due < td).length}</b> overdue</span>` +
    `<span><b>${done}</b> done</span>`;
  $("bar").style.setProperty("--p", pct);
  $("bar-fill").textContent = pct + "%";
  $("bar").setAttribute("aria-valuenow", pct);
  $("today-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const s = stats();
  const flame = s.streak ? `<b class="flame">${plural(s.streak, "day")} streak</b>` : `<b class="flame off">No streak yet</b>`;
  const hint = s.doneToday ? "" : s.streak ? "Finish a task today to keep it going. " : "Finish a task today to start one. ";
  $("streak").innerHTML = `${flame}<span class="streak-sub">${hint}${plural(s.week, "task")} finished this week · ${fmtMins(s.focus)} of focus time</span>`;

  // Daily goal
  const goal = prefs.dailyGoal;
  const reached = s.doneToday >= goal;
  $("goal").innerHTML = `<span class="goal-label">Today's goal</span>
    <span class="goal-dots" aria-hidden="true">${Array.from({ length: goal }, (_, i) => `<i${i < s.doneToday ? ' class="on"' : ""}></i>`).join("")}</span>
    <span class="goal-text">${reached ? `Goal reached! ${s.doneToday} done today` : `${s.doneToday} of ${goal} tasks done`}</span>
    <a href="#account" class="goal-edit">Change</a>`;
  $("goal").classList.toggle("reached", reached);

  renderWeek();

  $("chips").innerHTML = FILTERS.map(([k, l]) =>
    `<button type="button" class="chip" data-f="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join("");

  const subs = [...new Set(tasks.map((t) => t.subject).filter(Boolean))].sort();
  if (state.subj && !subs.includes(state.subj)) state.subj = "";
  $("f-subj").innerHTML = '<option value="">All subjects</option>' +
    subs.map((x) => `<option value="${esc(x)}" ${x === state.subj ? "selected" : ""}>${esc(x)}</option>`).join("");
  $("subj-list").innerHTML = subs.map((x) => `<option value="${esc(x)}">`).join("");
  $("sort").value = state.sort;

  const hiddenCount = state.filter === "all" && prefs.hideDone ? tasks.filter((t) => t.done).length : 0;
  $("hidden-note").hidden = !hiddenCount;
  if (hiddenCount) $("hidden-note").innerHTML = `${plural(hiddenCount, "finished task")} hidden. <button type="button" class="link-btn" data-f="done">Show finished tasks</button>`;

  const shown = tasks.filter(matches).sort(sorter);
  const list = $("list");
  if (!tasks.length) {
    list.innerHTML = `<li class="empty"><span>No tasks yet. Add your first assignment above.</span>
      <button type="button" class="small" id="btn-samples">Add 5 sample tasks to try it out</button></li>`;
  } else if (!shown.length) {
    list.innerHTML = `<li class="empty">${state.day ? "Nothing is due that day." : "No tasks match these filters."}</li>`;
  } else {
    list.innerHTML = shown.map((t) => (state.editing === t.id ? editRow(t) : taskRow(t))).join("");
  }
}

/* Week planner: the next 7 days with how much is due on each. */
function renderWeek() {
  const open = tasks.filter((t) => !t.done);
  const max = Math.max(1, ...Array.from({ length: 7 }, (_, i) => open.filter((t) => t.due === addDays(i)).length));
  let html = "";
  for (let i = 0; i < 7; i++) {
    const key = addDays(i);
    const d = new Date(key + "T00:00");
    const due = open.filter((t) => t.due === key);
    const hasHigh = due.some((t) => t.priority === "high");
    const name = i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString(undefined, { weekday: "short" });
    html += `<button type="button" class="day${due.length ? "" : " free"}" data-day="${key}" aria-pressed="${state.day === key}"
        aria-label="${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: ${plural(due.length, "task")} due">
      <span class="day-name">${name}</span>
      <span class="day-num">${d.getDate()}</span>
      <span class="load"><i style="height:${Math.round((due.length / max) * 100)}%"${hasHigh ? ' class="hi"' : ""}></i></span>
      <span class="day-count">${due.length ? plural(due.length, "task") : "Free"}</span>
    </button>`;
  }
  $("days").innerHTML = html;
  $("day-note").innerHTML = state.day
    ? `Showing tasks due ${new Date(state.day + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}. <button type="button" class="link-btn" id="day-clear">Show all days</button>`
    : "Tap a day to see only what's due then.";
}

function taskRow(t) {
  const d = dueInfo(t);
  const steps = t.steps || [];
  const stepsDone = steps.filter((s) => s.done).length;
  const isOpen = state.open.has(t.id);
  const stepPct = steps.length ? Math.round((stepsDone / steps.length) * 100) : 0;
  return `<li class="task p-${t.priority}${t.done ? " done" : ""}${isOpen ? " is-open" : ""}" data-id="${t.id}">
    <input type="checkbox" ${t.done ? "checked" : ""} data-a="toggle" aria-label="Mark ${esc(t.title)} as done">
    <div class="t-main"><div class="t-title">${esc(t.title)}</div>
      <div class="meta">${t.subject ? `<span class="subj">${esc(t.subject)}</span>` : ""}
        <span class="due ${d.cls}">${d.txt}</span><span>${cap(t.priority)} priority</span>
        ${t.focusMins ? `<span class="focus-tag">${fmtMins(t.focusMins)} focused</span>` : ""}</div>
      ${!t.done && d.diff !== null && d.diff < 0 ? `<button type="button" class="move-today" data-a="today">Move to today</button>` : ""}
      ${steps.length ? `<div class="steps-bar" title="${stepsDone} of ${steps.length} steps done"><i style="width:${stepPct}%"></i></div>
        <div class="steps-count">${stepsDone}/${steps.length} steps done</div>` : ""}
    </div>
    ${isOpen ? stepsPanel(t) : ""}
    <div class="acts">
      <button type="button" data-a="steps" aria-expanded="${isOpen}">${isOpen ? "Hide steps" : steps.length ? "Steps" : "+ Steps"}</button>
      ${t.done ? "" : `<button type="button" data-a="focus">Focus</button>`}
      <button type="button" data-a="edit">Edit</button>
      <button type="button" data-a="del">Delete</button>
    </div>
  </li>`;
}

function stepsPanel(t) {
  const steps = t.steps || [];
  return `<div class="steps">
    ${steps.length ? `<ul>${steps.map((s, i) => `<li${s.done ? ' class="done-step"' : ""}>
        <input type="checkbox" ${s.done ? "checked" : ""} data-a="step-toggle" data-i="${i}" aria-label="Step: ${esc(s.text)}">
        <span>${esc(s.text)}</span>
        <button type="button" class="step-x" data-a="step-del" data-i="${i}" aria-label="Remove step ${esc(s.text)}">×</button></li>`).join("")}</ul>`
      : `<p class="steps-empty">Break this task into smaller steps, like “Find 3 sources” or “Write intro”.</p>`}
    ${steps.length < MAX_STEPS ? `<form class="step-add">
      <input name="step" maxlength="100" placeholder="Add a step" aria-label="New step for ${esc(t.title)}">
      <button type="submit" class="small">Add</button></form>` : ""}
  </div>`;
}

function editRow(t) {
  const opts = ["high", "medium", "low"].map((p) => `<option value="${p}" ${p === t.priority ? "selected" : ""}>${cap(p)}</option>`).join("");
  return `<li class="task p-${t.priority}" data-id="${t.id}"><span></span>
    <div class="edit-row">
      <input class="full" id="e-title" value="${esc(t.title)}" maxlength="120" aria-label="Task">
      <input id="e-subj" value="${esc(t.subject)}" maxlength="40" aria-label="Subject" list="subj-list">
      <input id="e-due" type="date" value="${esc(t.due)}" aria-label="Due date">
      <select id="e-pri" aria-label="Priority">${opts}</select>
      <div class="btns"><button type="button" data-a="cancel">Cancel</button><button type="button" class="primary" data-a="save">Save</button></div>
    </div></li>`;
}

/* ---------------- task actions (Firestore) ---------------- */
$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("in-title").value.trim();
  if (!title) { $("in-title").focus(); return; }
  const data = {
    title,
    subject: $("in-subj").value.trim(),
    due: $("in-due").value,
    priority: $("in-pri").value,
    done: false, completedAt: null, steps: [], focusMins: 0,
    createdAt: serverTimestamp()
  };
  $("in-title").value = "";
  $("in-title").focus();
  try { await addDoc(tasksCol(), data); toast("Task added"); }
  catch (err) { toast(friendlyError(err)); }
});

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-f]");
  if (b) { state.filter = b.dataset.f; render(); }
});
$("hidden-note").addEventListener("click", (e) => {
  if (e.target.dataset.f) { state.filter = e.target.dataset.f; render(); }
});
$("search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("f-subj").addEventListener("change", (e) => { state.subj = e.target.value; render(); });
$("sort").addEventListener("change", (e) => { state.sort = e.target.value; sortTouched = true; render(); });

$("days").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  state.day = state.day === b.dataset.day ? "" : b.dataset.day;
  if (state.day) state.filter = "all";
  render();
});
$("day-note").addEventListener("click", (e) => {
  if (e.target.id === "day-clear") { state.day = ""; render(); }
});

$("list").addEventListener("click", async (e) => {
  if (e.target.id === "btn-samples") return addSamples();
  const el = e.target.closest("[data-a]");
  const a = el?.dataset.a;
  if (!a) return;
  const id = el.closest("[data-id]")?.dataset.id;
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  const ref = taskRef(id);
  try {
    if (a === "toggle") {
      const done = el.checked;
      if (done && timer.taskId === id) closeTimer();
      const p = updateDoc(ref, { done, completedAt: done ? Date.now() : null });
      toast(done ? celebrate() : "Marked not done");
      await p;
    }
    if (a === "del") {
      if (timer.taskId === id) closeTimer();
      state.open.delete(id);
      const { id: _drop, ...saved } = t;
      const p = deleteDoc(ref);
      toast("Task deleted", { label: "Undo", fn: () => setDoc(ref, saved).then(() => toast("Task restored")).catch((err) => toast(friendlyError(err))) });
      await p;
    }
    if (a === "today") { await updateDoc(ref, { due: today() }); toast("Moved to today"); }
    if (a === "edit") { state.editing = id; render(); $("e-title").focus(); }
    if (a === "cancel") { state.editing = null; render(); }
    if (a === "save") {
      const title = $("e-title").value.trim();
      if (!title) { $("e-title").focus(); return; }
      await updateDoc(ref, { title, subject: $("e-subj").value.trim(), due: $("e-due").value, priority: $("e-pri").value });
      state.editing = null;
      render();
      toast("Changes saved");
    }
    if (a === "steps") {
      state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      render();
      if (state.open.has(id)) document.querySelector(`[data-id="${id}"] .step-add input`)?.focus();
    }
    if (a === "focus") openTimer(id);
    if (a === "step-toggle") {
      const steps = (t.steps || []).map((s, i) => (i === +el.dataset.i ? { ...s, done: el.checked } : { ...s }));
      await updateDoc(ref, { steps });
    }
    if (a === "step-del") {
      const steps = (t.steps || []).filter((_, i) => i !== +el.dataset.i).map((s) => ({ ...s }));
      await updateDoc(ref, { steps });
    }
  } catch (err) { toast(friendlyError(err)); }
});

$("list").addEventListener("submit", async (e) => {
  const form = e.target.closest("form.step-add");
  if (!form) return;
  e.preventDefault();
  const input = form.elements.step;
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  const id = form.closest("[data-id]").dataset.id;
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  const steps = [...(t.steps || []).map((s) => ({ ...s })), { text, done: false }].slice(0, MAX_STEPS);
  try {
    await updateDoc(taskRef(id), { steps });
    document.querySelector(`[data-id="${id}"] .step-add input`)?.focus();
  } catch (err) { toast(friendlyError(err)); }
});

function celebrate() {
  const s = stats();
  const doneToday = s.doneToday + 1;
  if (doneToday === prefs.dailyGoal) return `Daily goal reached! ${plural(doneToday, "task")} done today.`;
  const left = tasks.filter((t) => !t.done).length - 1;
  if (left <= 0) return "Done! That was your last open task.";
  return `Done! ${plural(left, "task")} left.`;
}

async function addSamples() {
  const samples = [
    { title: "Read Chapter 6: Cell Respiration", subject: "Biology", due: addDays(0), priority: "high",
      steps: [{ text: "Read pages 112–120", done: true }, { text: "Answer review questions", done: false }] },
    { title: "Problem set 4 (questions 1–12)", subject: "Calculus", due: addDays(2), priority: "high", steps: [] },
    { title: "Outline argumentative essay", subject: "English", due: addDays(5), priority: "medium",
      steps: [{ text: "Pick a thesis", done: false }, { text: "Find 3 sources", done: false }, { text: "Write outline", done: false }] },
    { title: "Group project: send slides to team", subject: "History", due: addDays(-1), priority: "medium", steps: [] },
    { title: "Review vocabulary list 3", subject: "Filipino", due: addDays(4), priority: "low", steps: [] }
  ];
  try {
    const batch = writeBatch(db);
    samples.forEach((s) => batch.set(doc(tasksCol()), { ...s, done: false, completedAt: null, focusMins: 0, createdAt: serverTimestamp() }));
    await batch.commit();
    toast("Sample tasks added. Edit or delete them anytime.");
  } catch (err) { toast(friendlyError(err)); }
}

/* ---------------- calendar export (.ics) ---------------- */
// The file is built in the browser; nothing is uploaded anywhere.
$("btn-ics").addEventListener("click", () => {
  const due = tasks.filter((t) => !t.done && t.due);
  if (!due.length) { toast("No open tasks with due dates to export."); return; }
  const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const compact = (d) => d.replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Taskbook//Student Task Organizer//EN", "CALSCALE:GREGORIAN"];
  due.forEach((t) => {
    const steps = (t.steps || []).map((s) => `${s.done ? "[x]" : "[ ]"} ${s.text}`).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${t.id}@taskbook`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(t.due)}`,
      `DTEND;VALUE=DATE:${compact(addDays(1, new Date(t.due + "T00:00")))}`,
      `SUMMARY:${icsText((t.subject ? t.subject + ": " : "") + t.title)}`,
      `DESCRIPTION:${icsText(`${cap(t.priority)} priority${steps ? "\n" + steps : ""}`)}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  downloadFile("taskbook-due-dates.ics", lines.join("\r\n"), "text/calendar");
  toast(`Exported ${plural(due.length, "due date")}. Open the file to add them to your calendar.`);
});

/* ---------------- My Account page ---------------- */
function renderAccount(resetForms) {
  if (!user) return;
  refreshUserUI();
  const name = user.displayName || "";
  $("acc-avatar").textContent = initials();
  $("acc-title").textContent = name || "Your account";
  $("acc-email").textContent = user.email || "";
  const verified = user.emailVerified || hasGoogle();
  $("acc-verified").textContent = verified ? "Verified" : "Not verified";
  $("acc-verified").classList.toggle("warn", !verified);
  $("verify-box").hidden = verified;

  const since = user.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  const method = [hasPassword() && "email and password", hasGoogle() && "Google"].filter(Boolean).join(" and ");
  $("acc-meta").textContent = `${since ? "Member since " + since + " · " : ""}Signs in with ${method || "email"}`;

  const s = stats();
  const tiles = [
    [s.total, "tasks created"],
    [s.completed, "tasks finished"],
    [fmtMins(s.focus), "focus time"],
    [plural(s.streak, "day"), "current streak"],
    [plural(s.best, "day"), "best streak"],
    [s.topSubject || "—", "busiest subject"]
  ];
  $("acc-stats").innerHTML = tiles.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>`).join("");

  $("pw-form").hidden = !hasPassword();
  $("btn-reset-acc").hidden = !hasPassword();
  $("google-note").hidden = hasPassword();

  if (resetForms) {
    $("acc-name").value = name;
    $("p-goal").value = String(prefs.dailyGoal);
    $("p-focus").value = String(prefs.focusMin);
    $("p-break").value = String(prefs.breakMin);
    $("p-sort").value = prefs.defaultSort;
    $("p-sound").checked = !!prefs.sound;
    $("p-hide").checked = !!prefs.hideDone;
  }
  renderWipe();
}

$("name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("acc-name").value.trim().slice(0, 40);
  try {
    await updateProfile(auth.currentUser, { displayName: name || null });
    renderAccount(true);
    render();
    toast(name ? `Saved. Nice to meet you, ${name.split(/\s+/)[0]}!` : "Name removed");
  } catch (err) { toast(friendlyError(err)); }
});

$("btn-verify").addEventListener("click", async () => {
  try { await sendEmailVerification(auth.currentUser); toast(`Verification link sent to ${user.email}. Check your inbox and spam folder.`); }
  catch (err) { toast(friendlyError(err)); }
});
$("btn-verify-check").addEventListener("click", async () => {
  try {
    await auth.currentUser.reload();
    user = auth.currentUser;
    renderAccount(false);
    toast(user.emailVerified ? "Thanks! Your email is verified." : "Not verified yet. Click the link in the email first.");
  } catch (err) { toast(friendlyError(err)); }
});

$("pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cur = $("acc-cur-pw").value, next = $("acc-new-pw").value;
  if (!cur) return toast("Enter your current password.");
  if (next.length < 6) return toast("Use a new password with at least 6 characters.");
  if (next === cur) return toast("Choose a password that's different from your current one.");
  try {
    await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(user.email, cur));
    await updatePassword(auth.currentUser, next);
    $("acc-cur-pw").value = ""; $("acc-new-pw").value = "";
    toast("Password changed");
  } catch (err) {
    toast(["auth/invalid-credential", "auth/wrong-password"].includes(err?.code) ? "Your current password is incorrect." : friendlyError(err));
  }
});

$("btn-reset-acc").addEventListener("click", async () => {
  try { await sendPasswordResetEmail(auth, user.email); toast(`Reset link sent to ${user.email}.`); }
  catch (err) { toast(friendlyError(err)); }
});

$("prefs-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const next = {
    dailyGoal: +$("p-goal").value,
    focusMin: +$("p-focus").value,
    breakMin: +$("p-break").value,
    defaultSort: $("p-sort").value,
    sound: $("p-sound").checked,
    hideDone: $("p-hide").checked
  };
  try {
    sortTouched = false;
    await setDoc(userRef(), { prefs: next, updatedAt: serverTimestamp() });
    toast("Preferences saved");
  } catch (err) { toast(friendlyError(err)); }
});

/* Your data: download, delete tasks, delete account */
function renderWipe() {
  const wipe = $("wipe-area");
  if (state.confirm === "tasks") {
    wipe.innerHTML = `<div class="confirm">Delete all ${plural(tasks.length, "task")}? This can't be undone.
      <button type="button" data-w="cancel">Cancel</button><button type="button" class="danger" data-w="tasks-yes">Yes, delete tasks</button></div>`;
  } else if (state.confirm === "account") {
    wipe.innerHTML = `<div class="confirm-box">
      <p><b>Delete your account permanently?</b> Your tasks, preferences and login will be erased. This can't be undone.</p>
      ${hasPassword() ? `<div class="field"><label class="label" for="del-pw">Enter your password to confirm</label>
        <div class="pw"><input id="del-pw" type="password" autocomplete="current-password"><button type="button" class="pw-toggle" data-pw aria-label="Show password">Show</button></div></div>`
        : `<p class="hint">You'll be asked to sign in with Google once more to confirm.</p>`}
      <div class="row-btns"><button type="button" data-w="cancel">Cancel</button><button type="button" class="danger" data-w="account-yes">Delete my account</button></div>
    </div>`;
    $("del-pw")?.focus();
  } else {
    wipe.innerHTML = `<div class="row-btns">
      <button type="button" data-w="download">Download my data</button>
      <button type="button" class="danger" data-w="tasks">Delete all my tasks</button>
      <button type="button" class="danger" data-w="account">Delete my account</button></div>`;
  }
}

function exportData() {
  const out = {
    exportedAt: new Date().toISOString(),
    account: { name: user.displayName || "", email: user.email, created: user.metadata?.creationTime || null },
    preferences: prefs,
    tasks: tasks.map((t) => ({
      title: t.title, subject: t.subject || "", due: t.due || "", priority: t.priority, done: !!t.done,
      created: t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : null,
      completed: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      focusMinutes: t.focusMins || 0,
      steps: (t.steps || []).map((s) => ({ text: s.text, done: !!s.done }))
    }))
  };
  downloadFile("taskbook-my-data.json", JSON.stringify(out, null, 2), "application/json");
  toast(`Downloaded ${plural(tasks.length, "task")} and your account details.`);
}

async function deleteAllTasks() {
  closeTimer();
  const snap = await getDocs(tasksCol());
  // Firestore batches hold up to 500 writes.
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

$("wipe-area").addEventListener("click", async (e) => {
  const w = e.target.closest("[data-w]")?.dataset.w;
  if (!w) return;
  if (w === "download") return exportData();
  if (w === "tasks" || w === "account") { state.confirm = w; renderWipe(); return; }
  if (w === "cancel") { state.confirm = null; renderWipe(); return; }
  e.target.disabled = true;
  try {
    if (w === "tasks-yes") {
      await deleteAllTasks();
      toast("All your tasks were deleted");
    }
    if (w === "account-yes") {
      const u = auth.currentUser;
      // Firebase requires a recent sign-in before deleting an account.
      if (hasPassword()) {
        const pw = $("del-pw").value;
        if (!pw) { e.target.disabled = false; $("del-pw").focus(); return toast("Enter your password to confirm."); }
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, pw));
      } else {
        await reauthenticateWithPopup(u, new GoogleAuthProvider());
      }
      await deleteAllTasks();
      await deleteDoc(userRef());
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }
      if (unsubPrefs) { unsubPrefs(); unsubPrefs = null; }
      await deleteUser(u);
      history.replaceState(null, "", "#tasks");
      toast("Your account and all your data were deleted");
      return;
    }
  } catch (err) {
    e.target.disabled = false;
    toast(["auth/invalid-credential", "auth/wrong-password"].includes(err?.code) ? "That password is incorrect." : friendlyError(err));
    return;
  }
  state.confirm = null;
  if (user) renderWipe();
});

/* ---------------- focus timer (Pomodoro) ---------------- */
const timer = { taskId: null, mode: "focus", lenMin: DEFAULT_PREFS.focusMin, left: DEFAULT_PREFS.focusMin * 60, running: false, end: 0, h: null };
let baseTitle = document.title;
let audioCtx = null;

const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const modeMins = (m) => (m === "focus" ? prefs.focusMin : prefs.breakMin);

function openTimer(id) {
  if (timer.taskId !== id) { stopTicking(); timer.taskId = id; setMode("focus"); }
  $("focus").hidden = false;
  renderTimer();
}
function closeTimer() {
  stopTicking();
  timer.taskId = null;
  $("focus").hidden = true;
  document.title = baseTitle;
}
function setMode(m) {
  stopTicking();
  timer.mode = m;
  timer.lenMin = modeMins(m);
  timer.left = timer.lenMin * 60;
  renderTimer();
}
function stopTicking() {
  if (timer.running) timer.left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
  clearInterval(timer.h);
  timer.running = false;
  document.title = baseTitle;
}
function renderTimer() {
  const [fBtn, bBtn] = document.querySelectorAll("#focus [data-mode]");
  fBtn.textContent = `Focus · ${prefs.focusMin} min`;
  bBtn.textContent = `Break · ${prefs.breakMin} min`;
  if (!timer.taskId) return;
  const t = tasks.find((x) => x.id === timer.taskId);
  if (!t && tasks.length) { closeTimer(); return; }
  $("focus-task").textContent = t ? t.title : "";
  $("focus-label").textContent = timer.mode === "focus" ? "Focus session" : "Break time";
  $("focus").classList.toggle("on-break", timer.mode === "break");
  $("focus-time").textContent = mmss(timer.left);
  $("focus-start").textContent = timer.running ? "Pause" : timer.left < timer.lenMin * 60 ? "Resume" : "Start";
  fBtn.setAttribute("aria-pressed", timer.mode === "focus");
  bBtn.setAttribute("aria-pressed", timer.mode === "break");
}
function tick() {
  timer.left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
  $("focus-time").textContent = mmss(timer.left);
  document.title = `${mmss(timer.left)} · ${timer.mode === "focus" ? "Focus" : "Break"} — Taskbook`;
  if (timer.left === 0) finishSession();
}
async function finishSession() {
  clearInterval(timer.h);
  timer.running = false;
  document.title = baseTitle;
  if (prefs.sound) chime();
  if (timer.mode === "focus") {
    const id = timer.taskId, mins = timer.lenMin;
    setMode("break");
    toast(`Great work! ${mins} minutes added to this task. Take a ${prefs.breakMin}-minute break.`);
    try { await updateDoc(taskRef(id), { focusMins: increment(mins) }); }
    catch (err) { toast(friendlyError(err)); }
  } else {
    setMode("focus");
    toast("Break's over. Ready for another focus session?");
  }
}
function chime() {
  try {
    if (!audioCtx) return;
    [0, 0.25, 0.5].forEach((delay, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = [660, 880, 1046][i];
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + delay + 0.4);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + delay);
      o.stop(audioCtx.currentTime + delay + 0.45);
    });
  } catch { /* sound is optional */ }
}

$("focus-start").addEventListener("click", () => {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* no sound */ }
  if (timer.running) { stopTicking(); }
  else {
    if (timer.left === 0) timer.left = timer.lenMin * 60;
    timer.end = Date.now() + timer.left * 1000;
    timer.running = true;
    timer.h = setInterval(tick, 250);
    tick();
  }
  renderTimer();
});
$("focus-reset").addEventListener("click", () => setMode(timer.mode));
$("focus-close").addEventListener("click", closeTimer);
document.querySelector("#focus .focus-modes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (b) setMode(b.dataset.mode);
});

show("loading");
