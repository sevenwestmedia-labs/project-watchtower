import { Logger } from 'typescript-log'
import { BuildConfig } from '../../lib'
import doClean from '../clean'

const clean = (log: Logger, buildConfig: BuildConfig, ...paths: string[]) => {
    const { OUTPUT } = buildConfig
    return doClean(log, [
        OUTPUT,
        '{client,common,server}/**/*.{js,map}',
        'assets.json',
        'build-stats.csv',
        ...paths,
    ])
}

export default clean
