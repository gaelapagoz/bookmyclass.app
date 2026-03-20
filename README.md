# Studio SaaS Platform

## Setup environment

- Create Next.js project and setup Prisma

```bat
npx create-next-app@latest . --typescript
npm install @prisma/client
npm install -D prisma
npx prisma init --datasource-provider postgresql
```

- Create a docker container `docker-compose.yml` to instantiate a PostgreSQL DB

- Configure the credencials at .env

- Add Auth.js with the Prisma adapter.

```bat
npm install next-auth @auth/prisma-adapter
```

## Getting Started

src/
  app/
    (public)/
      page.tsx
      pricing/
        page.tsx
      schedule/
        page.tsx
      classes/
        [slug]/
          page.tsx
      online-programs/
        page.tsx
      loyalty-program/
        page.tsx
      about/
        page.tsx
      faq/
        page.tsx
      terms/
        page.tsx
      contact/
        page.tsx

    (auth)/
      login/
        page.tsx
      register/
        page.tsx
      forgot-password/
        page.tsx

    (client)/
      client/
        layout.tsx
        page.tsx
        profile/
          page.tsx
        bookings/
          page.tsx
        subscriptions/
          page.tsx
        loyalty/
          page.tsx
        purchases/
          page.tsx

    (teacher)/
      teacher/
        layout.tsx
        page.tsx
        sessions/
          page.tsx
        sessions/[sessionId]/
          page.tsx

    (admin)/
      admin/
        layout.tsx
        page.tsx
        clients/
          page.tsx
          [clientId]/
            page.tsx
        products/
          page.tsx
          new/
            page.tsx
          [productId]/
            page.tsx
        classes/
          page.tsx
        sessions/
          page.tsx
          [sessionId]/
            page.tsx
        calendar/
          page.tsx
        reports/
          page.tsx
        contact-messages/
          page.tsx

    api/
      auth/
        [...nextauth]/
          route.ts
      stripe/
        webhook/
          route.ts
      contact/
        route.ts

  components/
    ui/
    layout/
    auth/
    public/
    booking/
    client/
    teacher/
    admin/
    forms/
    tables/
    calendars/

  features/
    auth/
      auth.config.ts
      auth.ts
      permissions.ts
      session.ts
      validators.ts

    users/
      user.service.ts
      user.repo.ts
      user.types.ts

    clients/
      client.service.ts
      client.repo.ts
      client.validators.ts
      client.queries.ts

    teachers/
      teacher.service.ts
      teacher.repo.ts

    products/
      product.service.ts
      product.repo.ts
      product.validators.ts
      entitlement-rules.ts

    subscriptions/
      subscription.service.ts
      subscription.repo.ts
      subscription.types.ts

    credits/
      credit-ledger.service.ts
      credit-balance.service.ts

    loyalty/
      loyalty-ledger.service.ts
      loyalty.service.ts

    scheduling/
      class-template.service.ts
      session-generation.service.ts
      session.service.ts
      calendar.service.ts

    booking/
      booking.service.ts
      cancellation.service.ts
      waitlist.service.ts
      booking.validators.ts

    attendance/
      attendance.service.ts

    orders/
      order.service.ts
      order.repo.ts

    payments/
      stripe.service.ts
      webhook.service.ts
      payment.service.ts

    contact/
      contact.service.ts

    online-programs/
      access.service.ts

    audit/
      audit.service.ts

  lib/
    prisma.ts
    stripe.ts
    env.ts
    utils.ts
    date.ts
    currency.ts

  server/
    actions/
      client.actions.ts
      booking.actions.ts
      admin.actions.ts
      product.actions.ts

  prisma/
    schema.prisma
    migrations/
    seed.ts

  docs/
    business-rules.md
    erd.md
    permissions-matrix.md
    booking-state-machine.md
    event-flows.md

  tests/
    unit/
    integration/
    e2e/
## Integration Test Database

- Copy `.env.test.example` to `.env.test`.
- Set `DATABASE_URL` in `.env.test` to a dedicated test database (do not reuse development or production databases).
- Integration tests load `.env.test` explicitly and include a guard that requires `DATABASE_URL` to point to a database name containing `test`.
- Run tests with:

```bat
npm run test
```

## Test Database Setup

1. Create a Postgres database named `studio_test`.
2. Run:

```bat
npm run db:test:setup
```

3. Run tests:

```bat
npm run test
```
