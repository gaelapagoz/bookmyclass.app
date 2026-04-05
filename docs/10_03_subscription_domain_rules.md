# Subscription Domain Rules

## Purpose
This document defines the **source of truth** for subscription-related work in this project so future implementation does not drift into the wrong model.

## Core Rule
In this project, **Subscription is not limited to recurring Stripe billing**.

The business concept **Subscription** refers to the **sellable offerings shown under the Product catalog** that a customer can purchase for studio access or class participation.

### Therefore:
- **Product is the source of truth** for subscription offerings.
- **Subscription pages must be driven from `Product`**, not from a separate `Plan` model.
- **Do not invent or reintroduce a separate `Plan` abstraction** unless explicitly requested.

## Important Distinction
There are two different meanings that must not be mixed:

### 1. Business / Catalog meaning of Subscription
This is what the user sees and buys from the studio.
It comes from **Product**.

Examples may include:
- recurrent membership products
- drop-in products
- ticket packs
- class bundles
- other purchasable studio access products

If the item is part of the commercial catalog and belongs to the subscription/purchase offering space, it should be modeled from **Product**.

### 2. Billing mechanism meaning
This is **how Stripe charges** for a product.

A product may be billed as:
- recurring
- one-time
- credit-based
- pack-based

Recurring billing is only **one subtype of Product pricing**, not the definition of Subscription in this project.

## Modeling Rules

### Rule 1 — Catalog source
Any page that displays subscription/purchase offerings must read from:
- `Product`
- related `Price` records

Never use a separate `Plan` table for this.

### Rule 2 — UI naming
When discussing customer-facing offerings:
- use **Product** or **offering** internally
- use **Subscription** only as the page/business label if needed

Do not rename Product-based offerings into Plan unless explicitly requested.

### Rule 3 — Checkout behavior
Checkout logic must depend on the selected **Product** and its associated **Price**.

That means:
- request payloads should prefer `productId`
- server-side lookup should resolve Product + Price
- billing mode depends on the selected price type

### Rule 4 — Recurring is not the only valid subscription item
Do not assume the `/subscription` page should show only recurring items.

Unless explicitly requested otherwise, the subscription/purchase catalog may include multiple `Product` types, including:
- recurring memberships
- single-session products
- ticket packs
- bundles

### Rule 5 — Stripe mode is derived from Product/Price
Do not force everything into Stripe `subscription` mode.

Instead:
- use the selected Product/Price to determine whether checkout should be
  - recurring subscription mode, or
  - payment / one-time purchase mode, or
  - another existing fulfillment flow in the app

### Rule 6 — No duplicate domain model
Do not create parallel concepts like:
- Product + Plan
- Product + SubscriptionPlan
- Product + MembershipPlan

unless there is a clearly approved reason.

The default assumption is:
- **Product = catalog offering**
- **Price = billing configuration**
- **Subscription record = customer’s active purchased state**, if later needed for lifecycle tracking

## Architecture Guidance

### Correct layering
- **Product**: what is being sold
- **Price**: how it is billed
- **Order / Purchase / Enrollment / Subscription record**: what the customer currently owns after checkout

### Incorrect layering
- Introducing `Plan` to represent the same commercial item already represented by `Product`
- Filtering `/subscription` to recurring-only without explicit product direction
- Using Stripe billing mode to define catalog meaning

## Decision Rule for Future Changes
Before implementing any subscription-related change, answer this:

> Is this change about the commercial catalog the user can buy?

If yes, use **Product + Price**.

Then answer this:

> Is this change about how billing is processed after the user selects a product?

If yes, choose the billing flow based on the Product/Price configuration.

## Implementation Guardrails
When writing or reviewing code:
- prefer `productId` over `planId`
- prefer `product`, `price`, `offering` over `plan`
- do not filter to recurring-only unless the requirement explicitly says so
- do not create a new Prisma model for catalog items if `Product` already represents them
- do not assume “subscription” equals “Stripe recurring subscription”

## Review Checklist
Before merging any future subscription-related change, verify:
- Is the catalog data coming from `Product`?
- Is billing data coming from `Price`?
- Is any new `Plan` concept being introduced unnecessarily?
- Is the page incorrectly limited to recurring products only?
- Is Stripe checkout mode chosen from product/price rules instead of assumption?
- Are variable names using `productId` rather than legacy `planId`?

## Project-Specific Rule Summary
For this project:
- **All subscription offerings live under Product**
- **Recurring products are only one subset of Product offerings**
- **Do not equate Subscription with only recurrent monthly/yearly items**
- **Do not reintroduce Plan**
