import app from './app.js';
import { PORT } from './config/env.js';

app.listen(PORT, () => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
  }
  console.log(`Server started in ${process.env.NODE_ENV} mode.`);
});
