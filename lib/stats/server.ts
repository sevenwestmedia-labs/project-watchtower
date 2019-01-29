import dotenv from 'dotenv'
import http from 'http'
import { BuildConfig } from 'lib/runtime/server'
import os from 'os'
import path from 'path'
import { Logger } from 'typescript-log'
import { getPort } from '../runtime/server/custom-server'
import { findFreePort, waitForConnection } from '../runtime/util/network'
import { forkPromise } from '../util/process'
import { getTimeMs, timeout } from '../util/time'

export interface SSRStats {
    size: number
    time: number
    content: string
}

const getIp = () => {
    const interfaces = os.networkInterfaces()
    for (const i of Object.keys(interfaces)) {
        for (const address of interfaces[i]) {
            if (address.family === 'IPv4' && !address.internal) {
                return address.address
            }
        }
    }

    return os.hostname()
}

const getServerUrl = (port: number, urlPath: string) => {
    const useUrlPath = urlPath.indexOf('/') === 0 ? urlPath : '/' + urlPath

    const host = process.env.STATS_SERVER_ADDRESS || getIp() || 'localhost' // provided by build environment, ref OPS-383

    return `http://${host}:${port}${useUrlPath}`
}

export const loadSSRPage = (url: string) =>
    new Promise<SSRStats>((resolve, reject) => {
        const startTime = getTimeMs()

        const request = http.get(url, res => {
            res.setEncoding('utf8')

            let size = 0
            let content = ''
            res.on('data', chunk => {
                size += chunk.length
                content += chunk.toString()
            })

            res.on('end', () => {
                const time = getTimeMs() - startTime
                resolve({ size, time, content })
            })
        })
        request.on('error', err => reject(err))
    })

export interface StatsRunDetails {
    page: string
    urlPath: string
    url: string
    port: number
}

export type StatsFn = (details: StatsRunDetails) => Promise<any>

export const runStatsOnServer = async (
    log: Logger,
    buildConfig: BuildConfig,
    statsFn: StatsFn,
    verbose = false,
) => {
    const { OUTPUT, HAS_SERVER, STATS_ENV, STATS_PAGES } = buildConfig

    if (!HAS_SERVER) {
        log.info('Skipping server-based stats because the application has no server')
        return
    }

    dotenv.config({
        path: path.join(buildConfig.BASE, '.env'),
    })

    const port = await findFreePort(getPort(buildConfig.DEV_SERVER_PORT))

    const serverEntryFile = path.resolve(OUTPUT, 'server.js')
    const devServer = await forkPromise(
        log,
        serverEntryFile,
        [],
        {
            env: {
                NODE_ENV: 'production',
                ...process.env,
                ...STATS_ENV,
                PORT: port,
                PROJECT_DIR: buildConfig.BASE,
            },
            silent: !verbose,
        },
        true,
    )

    try {
        await timeout(waitForConnection(port), 20000)

        for (const page in STATS_PAGES) {
            if (STATS_PAGES.hasOwnProperty(page)) {
                const urlPath = STATS_PAGES[page]
                const url = getServerUrl(port, urlPath)

                // warm-up
                for (let i = 0; i < 3; i++) {
                    await timeout(loadSSRPage(url), 20000)
                }

                await statsFn({ page, urlPath, url, port })
            }
        }
    } catch (err) {
        throw err
    } finally {
        devServer.kill()
    }
}
