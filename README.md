Core Services

* API — https://route-runtime-service.netlify.app/api/health	
* Swagger UI — https://route-runtime-service.netlify.app/docs	
* Dashboard — https://route-runtime-service.netlify.app/dashboard	
* Snapshots — https://route-runtime-service.netlify.app/api/snapshots 
* State — https://route-runtime-service.netlify.app/api/state


Oncall Resolution for TTs (MCP layer)

GET https://route-runtime-service.netlify.app/api/mcp-context?service=allocation-engine-2.0
PUT https://route-runtime-service.netlify.app/api/mcp-context?service=allocation-engine-2.0&date=2026-03-02

PUT generates a unix timestamp for subsequent append only operations
This endpoint requires an instance of NETLIFY_AUTH_TOKEN
