import { Autowired, Injectable } from '@ali/common-di';
import {
  AppConfig, CommandRegistry, CorePreferences, Deferred, ExtensionActivateEvent,
  getPreferenceLanguageId, IClientApp, ILogger,
} from '@ali/ide-core-browser';
import { localize, OnEvent, WithEventBus } from '@ali/ide-core-common';
import { IExtensionStorageService } from '@ali/ide-extension-storage';
import { IDialogService, IMessageService } from '@ali/ide-overlay';
import { IIconService, IThemeService } from '@ali/ide-theme';
import { IWorkspaceService } from '@ali/ide-workspace';

import {
  ExtensionHostType, ExtensionNodeServiceServerPath, ExtensionService, IExtensionNodeClientService,
  IExtCommandManagement, IExtensionMetaData, LANGUAGE_BUNDLE_FIELD,
} from '../common';
import { ActivatedExtension } from '../common/activator';
import { AbstractNodeExtProcessService, AbstractViewExtProcessService, AbstractWorkerExtProcessService } from '../common/extension.service';
import { isLanguagePackExtension, MainThreadAPIIdentifier } from '../common/vscode';
import { Extension } from './extension';
import {
  ExtensionApiReadyEvent, ExtensionDidEnabledEvent, ExtensionBeforeActivateEvent,
  ExtensionDidUninstalledEvent, IActivationEventService, AbstractExtInstanceManagementService,
} from './types';

@Injectable()
export class ExtensionServiceImpl extends WithEventBus implements ExtensionService {
  static extraMetadata = {
    [LANGUAGE_BUNDLE_FIELD]: './package.nls.json',
  };

  @Autowired(ExtensionNodeServiceServerPath)
  private readonly extensionNodeClient: IExtensionNodeClientService;

  @Autowired(AppConfig)
  private readonly appConfig: AppConfig;

  @Autowired(CommandRegistry)
  private readonly commandRegistry: CommandRegistry;

  @Autowired(IActivationEventService)
  private readonly activationEventService: IActivationEventService;

  @Autowired(IWorkspaceService)
  private readonly workspaceService: IWorkspaceService;

  @Autowired(IExtensionStorageService)
  private readonly extensionStorageService: IExtensionStorageService;

  @Autowired(IThemeService)
  private readonly themeService: IThemeService;

  @Autowired(IIconService)
  private readonly iconService: IIconService;

  @Autowired(IDialogService)
  private readonly dialogService: IDialogService;

  @Autowired(IClientApp)
  private readonly clientApp: IClientApp;

  @Autowired(ILogger)
  private readonly logger: ILogger;

  @Autowired(IMessageService)
  private readonly messageService: IMessageService;

  @Autowired(CorePreferences)
  private readonly corePreferences: CorePreferences;

  @Autowired(AbstractWorkerExtProcessService)
  private readonly workerExtensionService: AbstractWorkerExtProcessService;

  @Autowired(AbstractNodeExtProcessService)
  private readonly nodeExtensionService: AbstractNodeExtProcessService;

  @Autowired(AbstractViewExtProcessService)
  private readonly viewExtensionService: AbstractViewExtProcessService;

  @Autowired(IExtCommandManagement)
  private readonly extensionCommandManager: IExtCommandManagement;

  @Autowired(AbstractExtInstanceManagementService)
  private readonly extensionInstanceManageService: AbstractExtInstanceManagementService;

  /**
   * 这里的 ready 是区分环境，将 node/worker 区分开使用
   */
  private ready = new Map<string, Deferred<void>>();

  // 存储 extension 的 meta 数据
  private extensionMetaDataArr: IExtensionMetaData[];

  // 针对 activationEvents 为 * 的插件
  public eagerExtensionsActivated: Deferred<void> = new Deferred();

  /**
   * @internal 提供获取所有运行中的插件的列表数据
   */
  async getActivatedExtensions(): Promise<{ [key in ExtensionHostType]?: ActivatedExtension[] }> {
    const activated = {};
    if (this.nodeExtensionService.protocol) {
      activated['node'] = await this.nodeExtensionService.getActivatedExtensions();
    }
    if (this.workerExtensionService.protocol) {
      activated['worker'] = await this.workerExtensionService.getActivatedExtensions();
    }

    return activated;
  }

  /**
   * 插件目录
   * 主要为插件的读取目录
   */
  private extensionScanDir = new Set<string>();

  /**
   * 补充的插件列表
   * 主要为插件的读取路径
   */
  private extensionCandidatePath = new Set<string>();

  @OnEvent(ExtensionActivateEvent)
  protected async onActivateExtension(e: ExtensionActivateEvent) {
    await this.activationEventService.fireEvent(e.payload.topic, e.payload.data);
  }

  /**
   * 插件激活后需更新插件进程数据
   */
  @OnEvent(ExtensionDidEnabledEvent)
  protected async onExtensionEnabled(e: ExtensionDidEnabledEvent) {
    const extension = e.payload;
    await this.updateExtHostData();
    this.fireActivationEventsIfNeed(extension.packageJSON.activationEvents);
  }

  /**
   * 插件卸载后需更新插件进程数据
   */
  @OnEvent(ExtensionDidUninstalledEvent)
  protected async onExtensionUninstalled() {
    await this.updateExtHostData();
  }

  public async activate(): Promise<void> {
    await this.initExtensionMetaData();
    await this.initExtensionInstanceData();
    await this.runExtensionContributes();
    await this.initThemeAndColor();
    this.doActivate();
  }

  /**
   * 初始化插件列表数据
   * 包括插件目录和插件 Candidate
   * 以及 ExtensionMetaData
   */
  private async initExtensionMetaData() {
    const { extensionDir, extensionCandidate } = this.appConfig;
    if (extensionDir) {
      this.extensionScanDir.add(extensionDir);
    }
    if (extensionCandidate) {
      extensionCandidate.forEach((extension) => {
        this.extensionCandidatePath.add(extension.path);
      });
    }

    this.extensionMetaDataArr = await this.getExtensionsMetaData(
      Array.from(this.extensionScanDir),
      Array.from(this.extensionCandidatePath),
    );
    this.logger.verbose('kaitian extensionMetaDataArr', this.extensionMetaDataArr);
  }

  /**
   * 初始化插件实例数据
   */
  private async initExtensionInstanceData() {
    for (const extensionMetaData of this.extensionMetaDataArr) {
      const isBuiltin = this.extensionInstanceManageService.checkIsBuiltin(extensionMetaData);
      const isDevelopment = this.extensionInstanceManageService.checkIsDevelopment(extensionMetaData);
      const extension = await this.extensionInstanceManageService.createExtensionInstance(extensionMetaData, isBuiltin, isDevelopment);
      if (extension) {
        this.extensionInstanceManageService.addExtensionInstance(extension);
      }
    }

    const extensionInstanceList = this.extensionInstanceManageService.getExtensionInstances();
    this.nodeExtensionService.updateExtensionData(extensionInstanceList);
    this.workerExtensionService.updateExtensionData(extensionInstanceList);
  }

  /**
   * 初始化 Theme 和 Icon Theme
   */
  private async initThemeAndColor() {
    await this.themeService.applyTheme(undefined, true);
    await this.iconService.applyTheme(undefined, true);
  }

  private async doActivate() {
    await this.workspaceService.whenReady;
    await this.extensionStorageService.whenReady;

    await this.viewExtensionService.activate();

    // 启动插件进程
    await this.startExtProcess(true);

    try {
      await this.eventBus.fireAndAwait(new ExtensionBeforeActivateEvent());
      await this.activationEventService.fireEvent('*');
    } catch (err) {
      this.logger.error(`[Extension Activate Error], \n ${err.message || err}`);
    } finally {
      // 表示 * 的插件全部激活完了
      this.eagerExtensionsActivated.resolve();
      this.activationEventService.fireEvent('onStartupFinished');
      // 表示 * 的插件可以调了
      this.eventBus.fire(new ExtensionApiReadyEvent());
    }
  }

  /**
   * 重启插件进程
   */
  public async restartExtProcess() {
    await this.startExtProcess(false);
  }

  private async startExtProcess(init: boolean) {
    // 重启场景下，需要将插件 dispose 掉并重新激活一遍
    if (!init) {
      this.disposeExtensions();
      await this.initExtensionInstanceData();
      await this.runExtensionContributes();
    }

    // set ready for node/worker
    await Promise.all([
      this.startNodeExtHost(init),
      this.startWorkerExtHost(init),
    ]);

    if (!init) {
      // 重启场景下把 ActivationEvent 再发一次
      if (this.activationEventService.activatedEventSet.size) {
        await Promise.all(Array.from(this.activationEventService.activatedEventSet.values()).map((event) => {
          this.logger.verbose('fireEvent', 'event.topic', event.topic, 'event.data', event.data);
          return this.activationEventService.fireEvent(event.topic, event.data);
        }));
      }
    }
  }

  private async startNodeExtHost(init: boolean) {
    // 激活 node 插件进程
    if (!this.appConfig.noExtHost) {
      const protocol = await this.nodeExtensionService.activate();
      this.extensionCommandManager.registerProxyCommandExecutor('node', protocol.get(MainThreadAPIIdentifier.MainThreadCommands));
      if (init) {
        this.ready.set('node', this.nodeExtensionService.ready);
      }
    }
  }

  private async startWorkerExtHost(init: boolean) {
    // 激活 worker 插件进程
    if (this.appConfig.extWorkerHost) {
      try {
        const protocol = await this.workerExtensionService.activate();
        this.extensionCommandManager.registerProxyCommandExecutor('worker', protocol.get(MainThreadAPIIdentifier.MainThreadCommands));
        if (init) {
          this.ready.set('worker', this.workerExtensionService.ready);
        }
      } catch (err) {
        this.logger.error(`Worker host activate fail, \n ${err.message}`);
      }
    }
  }

  /**
   * 更新插件进程中插件的数据
   */
  private async updateExtHostData() {
    const extensions = this.extensionInstanceManageService.getExtensionInstances();
    if (!this.appConfig.noExtHost) {
      await this.nodeExtensionService.updateExtensionData(extensions);
    }

    if (this.appConfig.extWorkerHost) {
      await this.workerExtensionService.updateExtensionData(extensions);
    }
  }

  /**
   * 发送 ActivationEvents
   */
  private fireActivationEventsIfNeed(activationEvents: string[]) {
    if (!Array.isArray(activationEvents) || !activationEvents.length) {
      return;
    }

    const startUpActivationEvents = ['*', 'onStartupFinished'];

    const _activationEvents = activationEvents.filter((event) => event !== '*');
    const shouldFireEvents = Array.from(
      this.activationEventService.activatedEventSet.values(),
    ).filter(({ topic, data }) => _activationEvents.find((_event) => _event === `${topic}:${data}`));

    for (const event of startUpActivationEvents) {
      if (activationEvents.includes(event)) {
        this.logger.verbose(`Fire activation event ${event}`);
        this.activationEventService.fireEvent(event);
      }
    }

    for (const event of shouldFireEvents) {
      this.logger.verbose(`Fire activation event ${event.topic}:${event.data}`);
      this.activationEventService.fireEvent(event.topic, event.data);
    }
  }

  /**
   * 将插件的目录位置和文件位置，通过后端读取并缓存
   * 返回所有插件的 meta data
   */
  private async getExtensionsMetaData(extensionScanDir: string[], extensionCandidatePath: string[]): Promise<IExtensionMetaData[]> {
    if (!this.extensionMetaDataArr) {
      const extensions = await this.extensionNodeClient.getAllExtensions(
        extensionScanDir,
        extensionCandidatePath,
        getPreferenceLanguageId(),
        ExtensionServiceImpl.extraMetadata,
      );
      this.extensionMetaDataArr = extensions;
    }
    return this.extensionMetaDataArr;
  }

  /**
   * 激活插件的 Contributes
   */
  private async runExtensionContributes() {
    const extensions = Array.from(this.extensionInstanceManageService.getExtensionInstances() as Extension[]);
    const languagePackExtensions: Extension[] = [];
    const normalExtensions: Extension[] = [];

    for (const extension of extensions) {
      if (isLanguagePackExtension(extension.packageJSON)) {
        languagePackExtensions.push(extension);
        continue;
      } else {
        normalExtensions.push(extension);
        continue;
      }
    }

    // 优先执行 languagePack 的 contribute
    await Promise.all(languagePackExtensions.map((languagePack) => languagePack.contributeIfEnabled()));
    await Promise.all(normalExtensions.map((extension) => extension.contributeIfEnabled()));

    this.commandRegistry.beforeExecuteCommand(async (command, args) => {
      await this.activationEventService.fireEvent('onCommand', command);
      return args;
    });
  }

  /**
   * 给 Extension 使用 | 激活插件
   */
  public async activeExtension(extension: Extension) {
    // 优先激活 Node 进程中的插件
    await this.nodeExtensionService.activeExtension(extension);

    await Promise.all([
      this.viewExtensionService.activeExtension(extension, this.nodeExtensionService.protocol),
      this.workerExtensionService.activeExtension(extension),
    ]);
  }

  public async disposeExtensions() {
    // 重置掉插件实例
    this.extensionInstanceManageService.resetExtensionInstances();

    await this.nodeExtensionService.disposeProcess();
    await this.workerExtensionService.disposeProcess();
  }

  // 给 contributes#command 注册 command executor 使用
  public async executeExtensionCommand(command: string, args: any[]): Promise<void> {
    const targetEnv = this.extensionCommandManager.getExtensionCommandEnv(command);
    if (!targetEnv) {
      throw new Error('No Command with id "' + command + '" is declared by extensions');
    }

    // 需要等待对应插件进程启动完成再执行指令
    await this.ready.get(targetEnv)?.promise;
    // 这里相比之前有个变化，之前是先找 command 存不存在，然后等 ready 再执行
    // 现在是先等 ready 再去找 command 再去执行
    return this.extensionCommandManager.executeExtensionCommand(targetEnv, command, args);
  }

  // 暴露给后端调用前端时使用，用来处理插件进程不存在和 crash/restart 时的弹窗
  private get invalidReloadStrategy() {
    // 获取corePreferences配置判断是否弹出确认框
    return this.corePreferences['application.invalidExthostReload'];
  }

  // RPC call from node
  public async $processNotExist() {
    const okText = localize('kaitianExtension.invalidExthostReload.confirm.ok');
    const options = [okText];
    const ifRequiredReload = this.invalidReloadStrategy === 'ifRequired';
    if (ifRequiredReload) {
      options.unshift(localize('kaitianExtension.invalidExthostReload.confirm.cancel'));
    }

    const msg = await this.dialogService.info(
      localize('kaitianExtension.invalidExthostReload.confirm.content'),
      options,
      !!ifRequiredReload,
    );

    if (msg === okText) {
      this.clientApp.fireOnReload();
    }
  }

  public async $processCrashRestart() {
    const okText = localize('common.yes');
    const options = [okText];
    const ifRequiredReload = this.invalidReloadStrategy === 'ifRequired';
    if (ifRequiredReload) {
      options.unshift(localize('common.no'));
    }

    const msg = await this.messageService.info(
      localize('kaitianExtension.crashedExthostReload.confirm'),
      options,
      !!ifRequiredReload,
    );
    if (msg === okText) {
      await this.restartExtProcess();
    }
  }
}
