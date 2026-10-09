# Copied from Grocerylist

These files are copied unchanged from [faint-flex/Grocerylist](https://github.com/faint-flex/Grocerylist)
at commit `40dd500` (branch `dinner-ideas-to-list`), except that `add-dinner.js`
imports from `./lib/` instead of `../public/js/lib/`.

They are how Grocerylist reads ingredient lines and puts a dinner on a shared
list. "Add to list" in Daily Brief uses them so both apps agree on the list's
format. If Grocerylist changes that format (its `STATE_VERSION` in `lib/merge.js`),
copy these files again.
