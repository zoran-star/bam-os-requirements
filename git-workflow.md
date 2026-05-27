# Git Workflow — How to Pull, Push, and Not Break Things

> Plain-English guide. Tech terms in brackets so you can match them up to anything you read elsewhere.

---

## 1 · The mental model — what git actually is

```
   You ───┐
          │
   Cole ──┼──→  GitHub  (the shared notebook in the cloud)
          │
   Cam ───┘
```

Everyone has their **own copy** of the notebook on their computer [your "local repo"]. GitHub holds the **master copy** [the "remote"]. The whole game is keeping the two in sync.

### Three states a file can be in

| State | Plain English | Tech term |
|---|---|---|
| 📝 Edited | You changed it on your computer | "modified" / "working tree" |
| 💾 Saved | You git-saved it, but only on your machine | "committed" |
| ☁️ Shared | It's on GitHub, everyone can see it | "pushed" |

---

## 2 · The 4-step routine — EVERY time you work

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. PULL  │ →  │ 2. EDIT  │ →  │ 3. COMMIT│ →  │ 4. PUSH  │
│ get latest    │ do work       │ save+note     │ share it │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### Step 1 · PULL — before you start
*"Get me the latest from GitHub"*

```bash
git pull
```

**Why it matters**: someone else may have changed things since you last worked. If you skip this, you'll edit an outdated copy and create a conflict you have to untangle later.

### Step 2 · EDIT
Just do your work. Edit files, add files, delete files. Git doesn't care yet.

### Step 3 · COMMIT — save with a note
*"Save my work to my local copy, with a description of what I did"*

```bash
git add .                              # tell git "save everything I changed"
git commit -m "Add Promo tile to menu" # save + describe what changed
```

**Write good commit messages.** This is how Cole/Cam know what you did:
- ✅ `"Add Promo tile to client portal menu"`
- ✅ `"Fix Stripe webhook timeout on cancellations"`
- ❌ `"stuff"` · `"updates"` · `"wip"`

### Step 4 · PUSH — share
*"Send my saved work up to GitHub"*

```bash
git push
```

Now everyone else can `git pull` and see your changes.

---

## 3 · The 5 rules of working with others

1. **Pull before you start.** Always.
2. **Push when you finish.** So others get your work right away.
3. **Never edit `main` directly when collaborating.** Use a **branch** (see §4).
4. **Commit small and often.** Easier to undo one tiny change than a giant tangled one.
5. **Write what changed in the commit message.** Future-you will thank present-you.

---

## 4 · Branches — your private sandbox

A **branch** [a "branch"] is your own copy of the project where you can mess around without affecting the main version that's deployed.

```
                  ┌─→ your-branch ──→ (you do stuff)
   main (live) ───┤
                  └─→ cole-branch ──→ (Cole does stuff)
```

When you're happy with your work, you open a **Pull Request (PR)** on GitHub — that's the "hey, review my work and merge it into main" button. Someone reviews, approves, and clicks merge.

### Branch commands

```bash
git checkout -b my-new-feature      # make a new branch and jump into it
# ... edit, commit ...
git push -u origin my-new-feature   # push your branch to GitHub the first time
                                     # (after the first time, just `git push`)
```

To go back to main:
```bash
git checkout main
git pull
```

### Why branches matter for BAM

Your repo **auto-deploys `main` to Vercel.** That means: merge to main = live for clients. If you commit broken code straight to main, the portal goes down for everyone. Branches + PRs prevent this.

---

## 5 · What to do when things go wrong

### 😬 "Your local changes would be overwritten by merge"
You have unsaved edits that fight with what's coming in from GitHub.

```bash
git stash        # set your edits aside (like a temporary clipboard)
git pull         # get the latest
git stash pop    # put your edits back on top
```

### 😬 "Updates were rejected because the remote contains work..."
Someone pushed before you did. Pull first, then push.

```bash
git pull
git push
```

### 😬 You accidentally committed something secret (.env, password)
**DON'T PUSH.** Stop and ask Claude. Once it's pushed, secrets are public forever.

### 😬 You don't know what state you're in
Just run:

```bash
git status
```

It shows: what's changed, what's saved, what's not. Run this anytime you're confused.

---

## 6 · Quick reference card

| You want to... | Command |
|---|---|
| Start your day | `git pull` |
| See what I changed | `git status` |
| Save my work locally | `git add .` then `git commit -m "what I did"` |
| Share my work | `git push` |
| Start a new feature safely | `git checkout -b feature-name` |
| Switch back to main | `git checkout main` |
| Throw away an unsaved change | `git restore <file>` *(careful — this deletes!)* |
| See recent history | `git log --oneline -10` |

---

## 7 · The "before I share my repo with someone" checklist

Before adding Cole/Cam/anyone else as a contributor:

- [ ] **`.gitignore` includes all secret files** (.env, .env.*, credentials, etc.)
- [ ] **`main` branch is protected on GitHub** (Settings → Branches → Require PR before merge)
- [ ] **Vercel env vars are set in the dashboard**, not in committed files
- [ ] **Each collaborator's CLAUDE.md says "pull before you start, push when you finish"**
- [ ] **You've shown them this guide** 😉

---

## TL;DR — the 4 commands you'll use 95% of the time

```bash
git pull                      # start of session
git add . && git commit -m "what I did"   # save
git push                      # end of session
git status                    # whenever you're confused
```

That's it. Do those four right and you'll basically never break anything.
