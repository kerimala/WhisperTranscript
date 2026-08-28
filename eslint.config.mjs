import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
    ...nextVitals,
    globalIgnores(["local_backend/.venv/**", "local_backend/.venv-diarization/**"]),
]);
