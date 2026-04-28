# GRC Portal

A full university-ready GRC web application built with Node.js, Express, EJS, and JSON files instead of a database.

## What it covers

This project combines:

- compliance obligations tracking
- policy management
- user and role overview
- audit-style activity logging
- policy acknowledgement records

## Main modules

- **Dashboard** with KPIs, urgent items, workload, and recent activity
- **Obligations register** with create, edit, delete, filtering, and detail views
- **Policy library** with create, edit, delete, review dates, and acknowledgement logging
- **Activity log** for traceability and audit-readiness style evidence
- **Users & roles** overview for ownership and access structure
- **Session user switcher** to demo different internal roles

## Tech stack

- Node.js
- Express
- EJS templates
- JSON file storage
- Vanilla CSS and JavaScript

## Run locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Notes

This is designed as a lightweight internal enterprise-style prototype. It uses JSON files instead of a database to keep the architecture simple and easy to explain in an academic project or demo.
