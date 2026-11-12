// Hebrew, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// words.test.ts fails when a file in he/ is missing here.
import w_account from './he/account.json';
import w_accountErrors from './he/accountErrors.json';
import w_actionbar from './he/actionbar.json';
import w_adminPage from './he/adminPage.json';
import w_aiApps from './he/aiApps.json';
import w_arrangeOptions from './he/arrangeOptions.json';
import w_askDialog from './he/askDialog.json';
import w_assembleTool from './he/assembleTool.json';
import w_backgroundSlice from './he/backgroundSlice.json';
import w_booleanTool from './he/booleanTool.json';
import w_brimEars from './he/brimEars.json';
import w_calibration from './he/calibration.json';
import w_chooseBar from './he/chooseBar.json';
import w_clearance from './he/clearance.json';
import w_colorMixing from './he/colorMixing.json';
import w_colourPicker from './he/colourPicker.json';
import w_common from './he/common.json';
import w_continue from './he/continue.json';
import w_convertDialog from './he/convertDialog.json';
import w_cutTool from './he/cutTool.json';
import w_deviceAddons from './he/deviceAddons.json';
import w_deviceAlertText from './he/deviceAlertText.json';
import w_deviceAlerts from './he/deviceAlerts.json';
import w_deviceArrange from './he/deviceArrange.json';
import w_deviceBrands from './he/deviceBrands.json';
import w_deviceBridge from './he/deviceBridge.json';
import w_deviceCamera from './he/deviceCamera.json';
import w_deviceCards from './he/deviceCards.json';
import w_deviceConsole from './he/deviceConsole.json';
import w_deviceEditor from './he/deviceEditor.json';
import w_deviceFiles from './he/deviceFiles.json';
import w_deviceHeads from './he/deviceHeads.json';
import w_deviceJob from './he/deviceJob.json';
import w_deviceLink from './he/deviceLink.json';
import w_deviceManage from './he/deviceManage.json';
import w_deviceMove from './he/deviceMove.json';
import w_devicePrinterErrors from './he/devicePrinterErrors.json';
import w_deviceScreen from './he/deviceScreen.json';
import w_deviceSend from './he/deviceSend.json';
import w_deviceSlots from './he/deviceSlots.json';
import w_deviceTimelapse from './he/deviceTimelapse.json';
import w_devices from './he/devices.json';
import w_engineSwitch from './he/engineSwitch.json';
import w_filamentLimit from './he/filamentLimit.json';
import w_filamentSync from './he/filamentSync.json';
import w_flowVariant from './he/flowVariant.json';
import w_flushVolumes from './he/flushVolumes.json';
import w_fontList from './he/fontList.json';
import w_gcodeErrors from './he/gcodeErrors.json';
import w_gcodeFallback from './he/gcodeFallback.json';
import w_groupMenu from './he/groupMenu.json';
import w_importPresets from './he/importPresets.json';
import w_language from './he/language.json';
import w_layerCodes from './he/layerCodes.json';
import w_layersPanel from './he/layersPanel.json';
import w_linkProgram from './he/linkProgram.json';
import w_loadingScreen from './he/loadingScreen.json';
import w_measureFigures from './he/measureFigures.json';
import w_objectList from './he/objectList.json';
import w_objectMenu from './he/objectMenu.json';
import w_objectSettings from './he/objectSettings.json';
import w_open from './he/open.json';
import w_openProject from './he/openProject.json';
import w_optionCheck from './he/optionCheck.json';
import w_optionField from './he/optionField.json';
import w_paintTool from './he/paintTool.json';
import w_pickReset from './he/pickReset.json';
import w_plateIcons from './he/plateIcons.json';
import w_plateMenu from './he/plateMenu.json';
import w_plateSettings from './he/plateSettings.json';
import w_presetChanges from './he/presetChanges.json';
import w_presetEngines from './he/presetEngines.json';
import w_presetFiles from './he/presetFiles.json';
import w_presetMenu from './he/presetMenu.json';
import w_presetSave from './he/presetSave.json';
import w_presetSettings from './he/presetSettings.json';
import w_previewColours from './he/previewColours.json';
import w_previewTab from './he/previewTab.json';
import w_printHistory from './he/printHistory.json';
import w_projectImport from './he/projectImport.json';
import w_projectMenu from './he/projectMenu.json';
import w_projectStore from './he/projectStore.json';
import w_saving from './he/saving.json';
import w_settingPicker from './he/settingPicker.json';
import w_settingsCheck from './he/settingsCheck.json';
import w_settingsPanel from './he/settingsPanel.json';
import w_settingsPrompt from './he/settingsPrompt.json';
import w_setupWizard from './he/setupWizard.json';
import w_shapePlacement from './he/shapePlacement.json';
import w_shapes from './he/shapes.json';
import w_sidebar from './he/sidebar.json';
import w_simplifyFirst from './he/simplifyFirst.json';
import w_simplifyTool from './he/simplifyTool.json';
import w_slicerEdits from './he/slicerEdits.json';
import w_slicerNotices from './he/slicerNotices.json';
import w_svgTool from './he/svgTool.json';
import w_tabs from './he/tabs.json';
import w_textTool from './he/textTool.json';
import w_theme from './he/theme.json';
import w_time from './he/time.json';
import w_timeFormat from './he/timeFormat.json';
import w_toolPanel from './he/toolPanel.json';
import w_toolbar from './he/toolbar.json';
import w_topbar from './he/topbar.json';
import w_uiParts from './he/uiParts.json';
import w_viewControls from './he/viewControls.json';
import w_viewport from './he/viewport.json';
import w_volumes from './he/volumes.json';

export default Object.assign(
  {},
  w_account,
  w_accountErrors,
  w_actionbar,
  w_adminPage,
  w_aiApps,
  w_arrangeOptions,
  w_askDialog,
  w_assembleTool,
  w_backgroundSlice,
  w_booleanTool,
  w_brimEars,
  w_calibration,
  w_chooseBar,
  w_clearance,
  w_colorMixing,
  w_colourPicker,
  w_common,
  w_continue,
  w_convertDialog,
  w_cutTool,
  w_deviceAddons,
  w_deviceAlertText,
  w_deviceAlerts,
  w_deviceArrange,
  w_deviceBrands,
  w_deviceBridge,
  w_deviceCamera,
  w_deviceCards,
  w_deviceConsole,
  w_deviceEditor,
  w_deviceFiles,
  w_deviceHeads,
  w_deviceJob,
  w_deviceLink,
  w_deviceManage,
  w_deviceMove,
  w_devicePrinterErrors,
  w_deviceScreen,
  w_deviceSend,
  w_deviceSlots,
  w_deviceTimelapse,
  w_devices,
  w_engineSwitch,
  w_filamentLimit,
  w_filamentSync,
  w_flowVariant,
  w_flushVolumes,
  w_fontList,
  w_gcodeErrors,
  w_gcodeFallback,
  w_groupMenu,
  w_importPresets,
  w_language,
  w_layerCodes,
  w_layersPanel,
  w_linkProgram,
  w_loadingScreen,
  w_measureFigures,
  w_objectList,
  w_objectMenu,
  w_objectSettings,
  w_open,
  w_openProject,
  w_optionCheck,
  w_optionField,
  w_paintTool,
  w_pickReset,
  w_plateIcons,
  w_plateMenu,
  w_plateSettings,
  w_presetChanges,
  w_presetEngines,
  w_presetFiles,
  w_presetMenu,
  w_presetSave,
  w_presetSettings,
  w_previewColours,
  w_previewTab,
  w_printHistory,
  w_projectImport,
  w_projectMenu,
  w_projectStore,
  w_saving,
  w_settingPicker,
  w_settingsCheck,
  w_settingsPanel,
  w_settingsPrompt,
  w_setupWizard,
  w_shapePlacement,
  w_shapes,
  w_sidebar,
  w_simplifyFirst,
  w_simplifyTool,
  w_slicerEdits,
  w_slicerNotices,
  w_svgTool,
  w_tabs,
  w_textTool,
  w_theme,
  w_time,
  w_timeFormat,
  w_toolPanel,
  w_toolbar,
  w_topbar,
  w_uiParts,
  w_viewControls,
  w_viewport,
  w_volumes,
) as Record<string, unknown>;
