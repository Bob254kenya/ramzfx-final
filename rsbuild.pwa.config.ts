import type { RsbuildPlugin } from '@rsbuild/core';
import { GenerateSW } from 'workbox-webpack-plugin';

export const pluginPWA = (): RsbuildPlugin => ({
    name: 'plugin-pwa',
    setup: (api) => {
        api.modifyRspackConfig((config, { isProd }) => {
            if (isProd) {
                config.plugins = config.plugins || [];
                config.plugins.push(
                    new GenerateSW({
                        swDest: 'service-worker.js',
                        clientsClaim: true,
                        skipWaiting: false,
                        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
                        runtimeCaching: [
                            {
                                urlPattern: /\.(?:png|jpg|jpeg|svg|gif|ico|webp)$/,
                                handler: 'CacheFirst',
                                options: {
                                    cacheName: 'images',
                                    expiration: {
                                        maxEntries: 60,
                                        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                                    },
                                },
                            },
                            {
                                urlPattern: /\.(?:js|css)$/,
                                handler: 'StaleWhileRevalidate',
                                options: {
                                    cacheName: 'static-resources',
                                },
                            },
                            {
                                urlPattern: /^\/api\//,
                                handler: 'NetworkFirst',
                                options: {
                                    cacheName: 'api-cache',
                                    networkTimeoutSeconds: 10,
                                    expiration: {
                                        maxEntries: 50,
                                        maxAgeSeconds: 5 * 60, // 5 minutes
                                    },
                                },
                            },
                            {
                                urlPattern: /^\/assets\//,
                                handler: 'CacheFirst',
                                options: {
                                    cacheName: 'assets',
                                    expiration: {
                                        maxEntries: 100,
                                        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                                    },
                                },
                            },
                            {
                                urlPattern: /\/$/,
                                handler: 'NetworkFirst',
                                options: {
                                    cacheName: 'pages',
                                    expiration: {
                                        maxEntries: 10,
                                        maxAgeSeconds: 60 * 60, // 1 hour
                                    },
                                },
                            },
                            {
                                urlPattern: /\.(?:woff|woff2|ttf|eot)$/,
                                handler: 'CacheFirst',
                                options: {
                                    cacheName: 'fonts',
                                    expiration: {
                                        maxEntries: 30,
                                        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                                    },
                                },
                            },
                        ],
                        exclude: [
                            /\.map$/,
                            /^manifest.*\.js$/,
                            /\.hot-update\.js$/,
                        ],
                        include: [
                            /\.html$/,
                            /\.js$/,
                            /\.css$/,
                            /\.svg$/,
                            /\.png$/,
                            /\.jpg$/,
                            /\.jpeg$/,
                            /\.ico$/,
                            /\.woff2$/,
                            /\.woff$/,
                            /\.ttf$/,
                            /\.eot$/,
                        ],
                    })
                );
            }
        });
    },
});