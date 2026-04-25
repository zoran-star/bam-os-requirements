---
name: LLM Chat Module for Onboarding
description: Strategy and positioning data should be collected via guided LLM chat, not forms
type: project
---

**Decision (2026-03-28):** The Strategy & Positioning section of onboarding should collect data through an LLM-guided chat module that helps the owner think through and optimize their answers — not static form fields.

**Why:** The owner needs help articulating their mission, values, problem, selling points, and origin story in a way that's compelling for marketing and AI use. A chat module can coach them through it, suggest improvements, and "exaggerate the problem to the end client."

**How to apply:** When building the onboarding UX, the strategy section should be a conversational flow where an LLM asks questions, the owner answers, and the LLM helps refine. Items that use this pattern:
- Mission Statement
- Core Values
- Origin Story
- Problem You Solve
- Target Customer Profile
- Selling Points

This is distinct from simple form fields (like Business Name, Address) which stay as direct inputs.
