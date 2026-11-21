# Run a formula assessment from RalphLAB Cloud

Open **Lab team → QSAR** in the selected project. Enter the registered PubChem CIDs, concentrations and application region. The OpenAI option calls `run_formula_qsar`. The paired runner resolves each CID against the verified local ingredient registry and runs the trained pipeline. The report shows the results for skin irritation, eye irritation, sensitization and acute toxicity, together with the applicability-domain and model-version fields. These predictions support research screening.

Configure the Site with its existing `OPENAI_API_KEY` and a secret `QSAR_RUNNER_TOKEN`. Configure the runner with the matching runner token and the Site origin in `RALPHLAB_SITE_URL`. The runner needs the scientific image, trained artifacts and populated project database. It connects out to the Site over HTTPS. Keep a runner online to process the queue.

For the default Compose installation run the following from the repository root. Include your local Compose override if it changes container names, ports or database settings.

```sh
docker compose -p ralphlab -f docker-compose.yml -f docker-compose.qsar-cloud.yml --profile qsar build worker
docker compose -p ralphlab -f docker-compose.yml -f docker-compose.qsar-cloud.yml --profile qsar up -d qsar-cloud
```
