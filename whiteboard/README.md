# Requirements Whiteboard

## What it's for
A standalone planning tool for running structured product review sessions. Items get approved, rejected, or given feedback — then exported to Claude Code for execution. The tool is project-agnostic; it can run sessions for any FullControl sub-project.

## Who's working on it
Zoran (product owner), Cole (requirements)

## Current status
Live and in active use. Sessions are being run regularly for the FullControl prototype and onboarding design.

## End goal
Every product decision in FullControl is traceable to a whiteboard session — a full history of what was approved, rejected, and why.

## Core blockers
None currently.

## How it connects to other projects
- **Notion** — session data, backlog items, and onboarding data points all live in Notion databases
- **prototype/sessions/** — HTML session output files from FullControl reviews live there, not here
- Every other project — this tool is used to plan changes to all of them
