# Taskbook — Student Task Organizer

A website where students sign in and track their assignments by subject, due date and priority. Tasks are saved in a Firebase database, so they show up on any device where the student signs in.

- **Hosting:** GitHub Pages
- **Login:** Firebase Authentication (email and password, plus Google sign-in)
- **Database:** Cloud Firestore

## Features

1. **Accounts and login.** Sign up (with an optional name), sign in, sign out, Google sign-in, password reset, email verification, and a show/hide password button.
2. **My Account page.** Profile with initials avatar, editable display name, verified-email status, progress stats (tasks created and finished, focus time, current and best streak, busiest subject), change password, saved preferences, download my data (JSON), delete all tasks and delete account.
3. **Task management.** Add, edit, complete and delete tasks with a subject, due date and priority. Includes **Undo** after deleting and a **Move to today** button on overdue tasks. Changes sync live across devices.
4. **Steps (subtasks).** Break a big assignment into smaller steps, check them off, and see a progress bar on the task card.
5. **Focus timer (Pomodoro).** Focus sessions and breaks with a chime, with lengths set in My Account. Finished sessions add to the task's focus time.
6. **Daily goal and streak.** Set how many tasks to finish each day and watch the dots fill up. A streak counts days in a row with at least one finished task.
7. **7-day week planner.** See how busy each of the next 7 days is, and tap a day to filter.
8. **Export to calendar.** Download an `.ics` file of due dates for Google Calendar, Apple Calendar or Outlook.
9. **Filters, search and sorting.** Filter by status and subject, search (including steps), sort, and optionally hide finished tasks.
10. **Friendly touches.** A personal greeting ("Good morning, Ana"), an offline notice, and clear error messages.

## Project files

```
index.html            Main app (sign-in screen + task organizer)
about.html            About page (what Taskbook is, features, getting started, creator)
privacy.html          Privacy Policy page
css/style.css         Styles (responsive, light and dark mode)
js/app.js             App logic (Firebase Auth + Firestore)
js/firebase-config.js Your Firebase project keys go here
images/logo.svg       Taskbook logo (also used as the browser tab icon)
images/*.png          Tab and home-screen icons in different sizes
favicon.ico           Tab icon for older browsers
manifest.webmanifest  App name and icon for "Add to Home Screen"
firestore.rules       Database security rules to paste into Firebase
```

---

## Setup (about 20 minutes)

### Step 1: Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Create a project**. Name it something like `taskbook`. You can turn off Google Analytics, since it isn't needed.
2. On the project home page, click the **Web** icon (`</>`) to add a web app. Name it `Taskbook`, but **do not** tick Firebase Hosting, because you're using GitHub.
3. Firebase shows a `firebaseConfig` object. Copy those values into `js/firebase-config.js`, replacing the placeholder values.

### Step 2: Turn on login

1. In the left menu, open **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.
3. Enable **Google** too. Pick a support email and save.

### Step 3: Create the database

1. Open **Build → Firestore Database → Create database**.
2. Choose a location. For the Philippines, `asia-southeast1` (Singapore) is closest. **The location can't be changed later.**
3. Start in **production mode**.
4. Open the **Rules** tab, delete what's there, paste in the whole contents of `firestore.rules`, and click **Publish**. If you published the rules before, publish this newer version again, since it adds the account preferences and the newer task fields.

### Step 4: Fill in your details

In `privacy.html` and `about.html`, replace:
- `[Your Name]` with your name
- `[your-email@example.com]` with the email people can contact you at
- In `about.html` only: `[Course / Strand and Section]` and `[School Name]`
- Optional: add your photo to the About page by saving it as `images/creator.jpg` (a square photo works best, ideally under 500 KB). If there's no photo, a person icon is shown.

### Step 5: Put it on GitHub Pages

1. Create a new **public** repository on GitHub, for example `taskbook`.
2. Upload all the project files, keeping the `css`, `js` and `images` folders. You can drag them into **Add file → Upload files**, then **Commit changes**.
3. Go to the repo's **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, then set **Branch** to `main` and the folder to `/ (root)`. Click **Save**.
4. After a minute or two, your site is live at:
   `https://YOUR-USERNAME.github.io/taskbook/`

### Step 6: Allow your GitHub address to sign in (important)

Firebase blocks sign-in from websites it doesn't know about.

1. In Firebase, go to **Authentication → Settings → Authorized domains → Add domain**.
2. Add `YOUR-USERNAME.github.io`, without `https://` and without `/taskbook`.

If you skip this step, Google sign-in shows the error "This website's address isn't allowed in Firebase yet."

---

## Test before you submit

Open your public URL in an **incognito/private window** so you see what a stranger sees, then check that you can:

- [ ] Create an account with email and password
- [ ] Add a task, then edit it, check it off, and delete it
- [ ] Add steps to a task and check them off
- [ ] Start the focus timer (to test quickly, set the focus session to 15 minutes in My Account, or wait it out)
- [ ] Tap a day in the week planner, then tap it again to show all days
- [ ] Click **Export to calendar** and open the downloaded file
- [ ] Delete a task, then press **Undo** in the message at the bottom
- [ ] Open **My Account**, save your name and see the greeting change
- [ ] Change a preference (for example, the daily goal), then sign in on another device and see it there
- [ ] Change your password, sign out, and sign in with the new one
- [ ] Click **Download my data** and open the file
- [ ] Use the filters, search and sort
- [ ] Sign out, sign back in, and see your tasks are still there
- [ ] Sign in on your phone and see the same tasks
- [ ] Try the site on your phone to confirm the layout fits the screen
- [ ] Open the About and Privacy Policy pages from the menu

## Common problems

| Problem | Fix |
|---|---|
| "Firebase isn't set up yet", or the page stays on "Loading…" | `js/firebase-config.js` still has the placeholder values. Paste in your real config. |
| "You don't have permission to do that" | The Firestore rules weren't published, or you published an old version. Redo Step 3.4. |
| Verification or reset emails don't arrive | Check the spam folder. You can change the sender name and wording in Firebase under **Authentication → Templates**. |
| Google sign-in says the address isn't allowed | Add your `github.io` domain (Step 6). |
| Google sign-in fails when testing with VS Code Live Server | In Firebase → Authentication → Settings → **Authorized domains**, add `127.0.0.1` (and `localhost`). Type only the domain, with no `http://`, no `:5500` and no `/`. |
| Page works on GitHub but not when double-clicking `index.html` | Expected. The app uses JavaScript modules, which need a web server. Use the GitHub URL, or run `python -m http.server` in the folder and open `http://localhost:8000`. |

## Is it safe to put the Firebase config on GitHub?

Yes. The `apiKey` in a Firebase web config only identifies your project and isn't a secret. What protects the data is `firestore.rules`: each user can only read and write their own tasks, and everything else is blocked.
