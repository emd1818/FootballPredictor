# V2.5 Railway deployment

This project is prepared for Railway using Docker + MySQL.

1. Create a Railway project.
2. Add a MySQL database service.
3. Deploy this repository/project as a service.
4. Add the variables from `.env.railway.example` in the app service.
5. Set `DATABASE_URL` to the Railway MySQL reference `${{MySQL.MYSQL_URL}}` (adjust service name if different).
6. Add the real `ODDS_API_KEY` and `API_FOOTBALL_KEY` as Railway Variables.
7. Keep `SCHEDULER_ENABLED=true` for a single app instance. If multiple replicas are later used, move scheduled ingestion to a dedicated worker/cron service.
8. Deploy. Railway should expose `/health` and provide a public HTTPS domain.
9. After the first successful deploy, check logs for API ingestion and database migration.

The application uses MySQL, so do not provision PostgreSQL for this version. Railway currently provides a MySQL template with `MYSQL_URL` and related connection variables.
