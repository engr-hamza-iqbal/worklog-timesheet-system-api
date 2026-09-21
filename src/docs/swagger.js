import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Work Log & Timesheet System API',
      version: '1.0.0',
      description:
        'RESTful API for recording daily employee work, managing multi-tier approval workflows, tracking client project billing, and evaluating capability-based permissions.',
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Provide the JWT token received from /api/auth/login',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  example: 'UNAUTHORIZED',
                },
                message: {
                  type: 'string',
                  example: 'Authentication required.',
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js', './src/routes/index.js'],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
