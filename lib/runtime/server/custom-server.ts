import express from 'express'
import { Logger } from 'typescript-log'
import { getConfig, getRuntimeConfig } from '../config/config'
import { findFreePort } from '../util/network'
import { setDefaultAssets } from './assets'
import { createEnsureRequestLogMiddleware } from './middleware/ensure-request-log-middleware'

export const isProduction = process.env.NODE_ENV === 'production'

export const getPort = (fallbackPort?: number) => {
    const port = parseInt(process.env.PORT || '', 10) || fallbackPort

    if (!port) {
        throw new Error('No port specified, set one through the PORT environmental variable')
    }

    return port
}

export const isWatchMode = () => process.env.START_WATCH_MODE === 'true'

export const isFastMode = () => process.env.START_FAST_MODE === 'true'

export interface CreateServerOptions {
    log: Logger

    /**
     * Early middleware hook is before static middleswares etc
     */
    earlyMiddlewareHook?: (app: express.Express & { log: Logger }) => void
    middlewareHook?: (app: express.Express & { log: Logger }) => void
    callback?: () => void
    startListening?: boolean
}

export interface CustomServerOptions {
    defaultHtmlMiddlewareHook?: (app: express.Express & { log: Logger }) => void
    nodeOnlyServer?: boolean
}

export const createCustomServer = (
    options: CreateServerOptions & CustomServerOptions,
): express.Express => {
    const config = getRuntimeConfig(options.log)

    const {
        earlyMiddlewareHook,
        middlewareHook,
        callback,
        defaultHtmlMiddlewareHook,
        nodeOnlyServer,
        startListening = true,
    } = options
    // To save the user passing the log to both create server and the SSR middleware
    // we make the log available on the app, so when the app is passed through
    // the ssr middleware can access the logger
    const app: express.Express & { log: Logger } = express() as any
    app.log = options.log

    app.disable('x-powered-by')

    // For server hot reload, we need to load default assets
    if (process.env.LOAD_DEFAULT_ASSETS && process.env.PROJECT_DIR) {
        const buildConfig = getConfig(options.log, process.env.PROJECT_DIR || process.cwd())

        // When running in dev mode, we don't use assets.json so we need to prime
        // the assets location
        setDefaultAssets(buildConfig)
    }

    // buildConfig is used for build time config, for example hot reload, and the PORT
    // in local development. In production the port will come from the environment, not
    // this config object
    if (process.env.NODE_ENV !== 'production' && isWatchMode()) {
        const buildConfig = getConfig(options.log, process.env.PROJECT_DIR || process.cwd())

        // When running in dev mode, we don't use assets.json so we need to prime
        // the assets location
        setDefaultAssets(buildConfig)

        // tslint:disable-next-line no-var-requires
        const { getHotReloadMiddleware } = require('../../server/dev')
        app.use(getHotReloadMiddleware(options.log, buildConfig))
    }

    app.use(createEnsureRequestLogMiddleware(options.log))

    if (earlyMiddlewareHook) {
        earlyMiddlewareHook(app)
    }

    // Express route prefixes have to start with /
    const assetsPathPrefixWithLeadingSlash =
        config.ASSETS_PATH_PREFIX[0] === '/'
            ? config.ASSETS_PATH_PREFIX
            : `/${config.ASSETS_PATH_PREFIX}`
    app.use(
        assetsPathPrefixWithLeadingSlash,
        express.static(config.ASSETS_PATH, {
            index: false,
        }),
    )

    if (config.SERVER_PUBLIC_DIR) {
        app.use(
            express.static(config.SERVER_PUBLIC_DIR, {
                index: false,
            }),
        )
    }

    if (middlewareHook) {
        middlewareHook(app)
    }

    if (defaultHtmlMiddlewareHook) {
        defaultHtmlMiddlewareHook(app)
    }

    if (!startListening) {
        return app
    }

    const listen = (usePort: number) => {
        const server = app.listen(usePort, () => {
            options.log.info(`Server listening on port ${usePort}`)
            if (!nodeOnlyServer && process.env.NODE_ENV !== 'production' && isWatchMode()) {
                // tslint:disable-next-line no-var-requires
                const { openBrowser } = require('../../server/dev')
                openBrowser(usePort)
            }
            if (callback) {
                callback()
            }
        })

        app.set('server', server)
    }

    const port = getPort()

    if (isProduction) {
        listen(port)
    } else {
        findFreePort(port).then(usePort => listen(usePort))
    }

    return app
}
