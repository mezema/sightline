# Legacy Tools

The repo still includes the earlier analyzer spike and local prototype. They are useful for reality checks, but the product app is `apps/web`.

Run the analyzer spike:

```sh
node src/run-spike.ts --description "scratch near left edge"
```

Run the old local prototype:

```sh
GEMINI_API_KEY="..." node src/prototype-server.ts
```

Open:

```text
http://localhost:4173/prototype/
```
