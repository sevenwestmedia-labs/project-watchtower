import merge from 'webpack-merge'
import { getWebpackHooks, getHook } from './webpack-hooks'
import { baseConfig } from './webpack.base'
import { prodConfig } from './webpack.prod'
import { serverBaseConfig } from './webpack.server'
import { CreateWebpackConfig } from '.'
import { getTypeScriptLoaderWebpackConfig } from './typescript-loaders-config'

/** Webpack config for the server in production */
export const serverProdConfig: CreateWebpackConfig = (options) => {
    const webpackHooks = getWebpackHooks(options.log, options.buildConfig.BASE)

    return merge(
        baseConfig(options),
        getTypeScriptLoaderWebpackConfig(options, 'server', 'prod'),
        getHook(webpackHooks.base, options),
        serverBaseConfig(options),
        getHook(webpackHooks.server, options),
        prodConfig(options),
        getHook(webpackHooks.prod, options),
        getHook(webpackHooks.serverProd, options),
    )
}
