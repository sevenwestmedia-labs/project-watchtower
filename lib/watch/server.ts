import { ChildProcess, fork } from 'child_process'
import dotenv from 'dotenv'
import express from 'express'
import { Server } from 'http'
import proxyMiddleware from 'http-proxy-middleware'
import { BuildConfig } from 'lib/runtime/server'
import path from 'path'
import { Logger } from 'typescript-log'
import webpack from 'webpack'
import { getWebpackConfig } from '../build/build'
import { getPort } from '../runtime/server/custom-server'
import { findFreePort, waitForConnection } from '../runtime/util/network'
import { getHotReloadMiddleware, openBrowser } from '../server/dev'

const restartServer = (
    buildConfig: BuildConfig,
    port: number,
    projectDir: string,
    oldServer?: ChildProcess,
) => {
    if (oldServer) {
        oldServer.kill()
    }

    // When running in local dev, we have a different process.cwd() than
    // when running in production. This allows static files and such to resolve
    return fork(path.resolve(buildConfig.OUTPUT, 'server.js'), [], {
        env: {
            ...process.env,
            LOAD_DEFAULT_ASSETS: true,
            PORT: port,
            PROJECT_DIR: projectDir,
        },
    })
}

export interface WatchServer {
    app: express.Express
    server: Server
    close: () => Promise<any>
}

const watchServer = (log: Logger, buildConfig: BuildConfig, nodeOnlyServer: boolean) =>
    new Promise<WatchServer>(async resolve => {
        dotenv.config({
            path: path.join(buildConfig.BASE, '.env'),
        })

        const hostPort = await findFreePort(getPort(buildConfig.DEV_SERVER_PORT))
        const devServerPort = await findFreePort(hostPort + 1)

        let devServer: ChildProcess
        let devServerAvailable: Promise<any>

        const serverCompiler = webpack(getWebpackConfig(log, buildConfig, 'server', 'dev'))

        serverCompiler.hooks.invalid.tap('invalid', () => {
            log.info('⭐  Server changed, rebuilding and restarting server...  ⭐ ')
        })

        const watching = serverCompiler.watch(
            {
                aggregateTimeout: 500,
            },
            () => {
                if (!devServer && !nodeOnlyServer) {
                    setTimeout(() => openBrowser(hostPort), 2000)
                }
                devServer = restartServer(buildConfig, devServerPort, buildConfig.BASE, devServer)

                setTimeout(() => {
                    devServerAvailable = waitForConnection(devServerPort)
                }, 100)
            },
        )

        const app = express()

        app.use(getHotReloadMiddleware(log, buildConfig))

        app.use(async (_req, _res, next) => {
            await devServerAvailable
            next()
        })

        app.use(proxyMiddleware('http://localhost:' + devServerPort))

        const server = app.listen(hostPort, () => {
            resolve({
                app,
                close: () => {
                    return Promise.all([
                        new Promise(closeResolve =>
                            watching.close(() => {
                                closeResolve()
                            }),
                        ),
                        new Promise(closeResolve => server.close(() => closeResolve())),
                    ]).then(() => {
                        if (devServer) {
                            devServer.kill()
                        }
                    })
                },
                server,
            })
        })

        app.set('server', server)
    })

export default watchServer
