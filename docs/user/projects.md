# Coordinators

A coordinator is a thread that plans a project's work and hands each piece to a thread of its own. It reads files and answers quick questions itself. For anything that changes files, it starts a delegated thread, and it tells you when that thread finishes or needs you.

## Start a coordinator

Right-click a project in the sidebar, or the project name in the chat header, and choose **New coordinator**, or search the command palette for "New coordinator". To turn an existing thread into one, choose **Make coordinator** from its thread menu. **Stop coordinating** turns it back into an ordinary thread. Threads a coordinator delegated cannot become coordinators themselves.

## Threads, Library, and Scheduled

The header of a coordinator, or of any thread that delegated work, has three panels:

- **Threads** lists the threads it delegated, grouped by what each needs from you, with what each last did. A dot on the button means something needs you: a delegated thread is waiting on you or has a pull request ready for your review, or the thread itself is asking, failed, or finished since you last looked.
- **Library** holds the project's non-code deliverables, such as reports, notes, and docs, with the thread that wrote each. Add or remove files there yourself.
- **Scheduled**, in the **⋯** menu, lists the project's scheduled tasks.

## On your phone

In the mobile app, tap the checklist button on a new thread to start it as a coordinator, or choose **Make coordinator** from a thread's long-press menu. A coordinator's header has a checklist button that opens its **Overview**, with the same Threads, Library, and Scheduled tabs; it turns amber on iPhone, or shows a dot on Android, when something needs you. Long-press a delegated thread to mark it resolved, reopen it, or stop it. The drawer's **Artifacts** row opens the Library of the project you are in. Edit project instructions and memory from the Overview's **⋯** menu or **Settings → Projects → Instructions and memory**.

## Pinned projects

Pin a project from its right-click menu, the command palette, or its settings. Pinned projects are listed under **Pinned** at the top of the sidebar and the mobile drawer. Selecting one opens its most recent coordinator. When it has none, the sidebar starts a new coordinator and the drawer shows the project's threads. A dot means one of its coordinators needs you, by the same rule as the Threads button. Right-click a pinned project, or long-press it on your phone, to unpin it.

The sidebar's **Artifacts** row opens the Library of the thread you have open, and **Scheduled** opens your scheduled tasks.

## Project instructions and memory

Each project has standing instructions and a memory file. Every coordinator and every thread it delegates starts with both, along with the Library's location. Edit them from **⋯ → Project instructions** in a coordinator, the command palette, or **Settings → Projects → Instructions and memory**. Changes reach threads started afterwards, and a running coordinator on its next turn. The same editor sets the model new coordinators start on and the model their delegated threads use.

## Where work happens

Each delegated thread runs in its own git worktree, so threads do not edit the same files and your main checkout stays as it was.

## The read-only lock

A coordinator cannot edit files or run commands in its own checkout, and it can only message or answer for threads it delegated. Claude enforces this fully, and Codex enforces it through its own sandbox. Other providers do not fully lock a coordinator read-only and can change files in the main checkout. T3 Code shows a **Not read-only** badge on such a coordinator and asks before you make one.
