# Donato Plumbing – QA/QC Plumbing Rough-In

Live QA/QC checklist app for the plumbing rough-in inspections at 1011 1st Ave.

**App:** https://1011dfinishes.github.io/qaqcd1011/

## What it does

- Floors 2, 6 and 7 (19, 32 and 29 units). Every unit has the same checklist: 89 questions in 9 sections, taken from the *QA/QC Plumbing Rough-In Tracker* spreadsheet.
- Each question is answered **Y**, **N** or **N/A**. An answer that matches the question's *problem answer* is flagged as a **Deficiency**; everything else is OK.
- A deficiency can carry notes, photos, a corrective action, who is responsible, a due date, the date it was corrected and who verified it. It is **Open**, **Overdue** (due date passed) or **Closed** (has a "Corrected on" date).
- A unit is **Not started**, **In progress**, **Fail** (any open deficiency) or **Pass** (every question answered, nothing open).
- Each floor has a punch list of its deficiencies and a count by section.
- **Sign-off**: each unit is signed with a finger by the Donato Representative and the CCM Representative (print name, signature, date), like the Finishes app.
- **PDF export**: a report for one unit (letterhead, details, totals, the full checklist with Y / N / N/A boxes, every deficiency with its details and photos, comments, signatures), or for a whole floor (cover with every unit and page links, punch list, deficiencies by section, then the report of each unit that has been started).
- **Editors** sign in and can change everything. **Guests** can see everything and change nothing.
- **Checklist questions** (editors only, on the first page): add, edit, move, remove or delete a question, rename a section, and choose which answer is the problem (No, Yes, or neither).
- Changes show up live on every phone. With no signal the app still opens, answers and photos are kept on the phone, and they upload when the signal is back.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page and all of its styling |
| `config.js` | Floors and unit counts, and the Supabase address and public key |
| `app.js` | The app |
| `sb.js` | Talks to Supabase (sign-in, database, live updates, photo storage) |
| `pdf.js` | Builds the PDF reports on the phone |
| `sw.js` | Keeps a copy of the app on the phone so it opens with no signal |
| `manifest.webmanifest`, `icon-*.png`, `letterhead.png`, `letterhead.jpg` | Home-screen icon and letterhead |

To change the floors or the number of units, edit the `FLOORS` list at the top of `config.js`.

After changing any file, raise the number in `?v=2` on the four script lines at the bottom of `index.html`
and in `dq-shell-v2` at the top of `sw.js`, so phones pick up the new version.

## Where the data lives

The app uses the same Supabase project as the Finishes app, with its own tables and its own photo bucket.
Nothing here reads or changes the Finishes data.

| In Supabase | Holds |
| --- | --- |
| `roughin_questions` | The checklist: section, question, problem answer, order |
| `roughin_answers` | One row per floor, unit and question: the answer and the deficiency details |
| `roughin_units` | Inspected on / by and comments for each unit |
| `roughin_project` | The project address |
| `roughin_photos` + storage bucket `roughin` | Photos of deficiencies |
| `roughin_signatures` (pictures in `roughin/sig/`) | Sign-off signatures, two per unit |

Editors are the people on the existing `editors` list (the same list the Finishes app uses), signing in with the same email and password.
Everyone can read; only editors can change anything. That rule is enforced by the database, not just by the app.
