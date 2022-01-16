import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile, TFolder } from 'obsidian';
import { TextInputSuggest } from "suggest";

interface MyPluginSettings {
	variableFile: string,
	debugPrint: boolean,
	backupFolder: string,
	backupEnable: boolean,
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	variableFile: "",
	debugPrint: false,
	backupFolder: "",
	backupEnable: true,
}

export interface IHash {
    [details: string] : any;
} 

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	variableList: IHash = {};
	substitutionRegex = /(<span class="var-start">([\w-]+)<\/span>).*(<span class="var-end">([\w-]+)<\/span>)/g;

	async onload() {
		await this.loadSettings();

		// Substitution in current file
		this.addCommand({
			id: 'substitute-variable-in-current-file',
			name: 'Substitute variable in current file',
			callback: async () => {
				this.runSubstitution(true);
			}
		});
		// Substitution in all files
		this.addCommand({
			id: 'substitute-variable-in-all-files',
			name: 'Substitute variable in all files',
			callback: async () => {
				this.runSubstitution(false);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Load the variables from the variable file into variableList
	loadVariable(){
		return new Promise<void>((resolve, reject) => {
			this.app.vault.adapter.read(this.settings.variableFile)
				.then((text) => {
					var lines = text.split("\n");
					lines.forEach(line => {
						var splits = line.split(/:(?<!\\:)/);
						if(splits.length==2){
							this.variableList[splits[0]] = splits[1];
						}
					});
				})
				.catch((err) => {
					console.error(err);
					new Notice(err);
				})
				.finally(() => {
					// console.log(this.variableList);
					resolve();
				});
		})
	}

	// Some checking and precond before substitution starts
	async runSubstitution(singleFile:boolean){
		const exist = await Utils.fileExists(this.app, this.settings.variableFile);
		if(exist){
			await this.loadVariable();
			if(Utils.isEmpty(this.variableList)){
				new Notice(`No definition in "${this.settings.variableFile}"`);
			}else{
				if(singleFile){
					this.substitution(this.app.workspace.getActiveFile())
				}else{
					this.substitutionAll();
				}
			}
		}else{
			new Notice(`Variable File, "${this.settings.variableFile}" is not found. Please configure it in plugin options`);
		}
	}

	// Iterate over the lines in file to look for variable to substitute
	substitution = (file:TFile, singleFileMode=true):Promise<IHash> => {
		let variableStatus:IHash = {}
		return new Promise((resolve, reject) => {
			this.app.vault.adapter.read(file.path)
			.then(async (text) => {
				var lines = text.split("\n");
				// lines.forEach((line, n) => {
				for(var n in lines) {
					const line = lines[n];
					var regex_out = this.substitutionRegex.exec(line);
					if(regex_out){
						var start_var = regex_out[2];
						var end_var = regex_out[4];
						var start_syntax = regex_out[1];
						var end_syntax = regex_out[3];
						if (!variableStatus[start_var]) {
							variableStatus[start_var] = {}
						}
						if (start_var != end_var){
							new Notice(`${start_var} and ${end_var} does not match at line ${n} of ${file.path}`);
							variableStatus[start_var]["error"] = `${start_var} and ${end_var} does not match at line ${n}`;
						}
						else if(!(start_var in this.variableList)){
							new Notice(`${start_var} is not defined`);
							variableStatus[start_var]["error"] = `${start_var} is not defined`;
						}else if(regex_out[0] == start_syntax+this.variableList[start_var]+end_syntax){
							variableStatus[start_var]["modified"] = false;
							// ensure the "modified" is not overwriting current value and only be added to file with variables
							if(!("modified" in variableStatus)){
								variableStatus["modified"] = false;
							}
						}else{
							variableStatus["modified"] = true;
							variableStatus[start_var]["modified"] = true;
							lines[n] = line.replace(this.substitutionRegex,start_syntax+this.variableList[start_var]+end_syntax);
						}
					}
				};
				if(variableStatus["modified"] == true){
					if(this.settings.backupEnable && !singleFileMode){
						await this.backup(file)
					}
					this.app.vault.adapter.write(file.path,lines.join("\n"))
					.then(() => {
						if(singleFileMode)
							new Notice(`Substitution is done`);
					})
					.catch((err) => {
						console.error(err);
						new Notice(err);
					});
				}else if(!Utils.isEmpty(variableStatus)){
					if(singleFileMode)
						new Notice(`Nothing is updated`);
				}
				else{
					if(singleFileMode)
						new Notice(`No variable is found`);
				}
			})
			.catch((err) => {
				console.error(err);
				new Notice(err);
			})
			.finally(() => {
				resolve(variableStatus);
				if(singleFileMode && this.settings.debugPrint)
					console.log(variableStatus);
			});
		})
	}

	// Iterate over all markdown files and do the substitution
	async substitutionAll(){
		const all_files = Utils.getTfilesList(this.app, true);
		let overallStatus: IHash = {};
		let updatedFileCount = 0;

		await all_files.reduce(async (promise, file) => {
			await promise;
			const result:IHash = await this.substitution(file,false);
			if(!Utils.isEmpty(result) && this.settings.debugPrint){
				overallStatus[file.path] = result;
			}
			if(result["modified"]){
				updatedFileCount+=1;
			}
		}, Promise.resolve());

		if(this.settings.debugPrint){
			console.log(`${updatedFileCount} file is modified`);
			console.log(overallStatus);
		}
		if(updatedFileCount>0)
			new Notice(`Substitution is done`);
		else
			new Notice(`Nothing is updated`);
	}

	// Backup the file to backupFolder
	backup(file:TFile){
		return new Promise<void>(async (resolve, reject) => {
			let backupFileName = `${this.settings.backupFolder}/${file.name}.bak`
			const exist = await Utils.fileExists(this.app, backupFileName);
			if(exist){
				await this.app.vault.adapter.remove(backupFileName)
			}
			this.app.vault.copy(file,`${this.settings.backupFolder}/${file.name}.bak`)
			.then(() => {
				resolve()
			})
		});
	}
}

class SettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'Settings'});

		new Setting(containerEl)
			.setName('Variable File Location')
			.setDesc('File where variables are defined')
			.addSearch((cb) => {
				new FileSuggest(
					this.app,
					cb.inputEl,
					this.plugin,
				);
				cb.setPlaceholder("Example: folder1/template_file")
					.setValue(this.plugin.settings.variableFile)
					.onChange((new_value) => {
						this.plugin.settings.variableFile = new_value;
						this.plugin.saveData(this.plugin.settings);
					})
			});
		
		new Setting(containerEl)
            .setName("Enable Backup")
            .setDesc('Enable backup before substition. Only applicable to "Substitute variable in all files". For "Substitute variable in current file", please use ctrl+z to undo.')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.debugPrint)
                    .onChange(async value => {
                        this.plugin.settings.debugPrint = value;
                        await this.plugin.saveSettings();
                    });
            });

		new Setting(containerEl)
			.setName('Backup Folder')
			.setDesc('Folder where the files will be backup before substitution. Only applicable to "Substitute variable in all files"')
			.addSearch((cb) => {
				new FolderSuggest(
					this.app,
					cb.inputEl,
				);
				cb.setPlaceholder("Example: folder1")
					.setValue(this.plugin.settings.backupFolder)
					.onChange((new_value) => {
						this.plugin.settings.backupFolder = new_value;
						this.plugin.saveData(this.plugin.settings);
					})
			});
		
		new Setting(containerEl)
            .setName("Debug Print")
            .setDesc("Print the list of variables for each file")
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.debugPrint)
                    .onChange(async value => {
                        this.plugin.settings.debugPrint = value;
                        await this.plugin.saveSettings();
                    });
            });
	}
}

// Credits go to Liam's Periodic Notes Plugin: https://github.com/liamcain/obsidian-periodic-notes. 
// Slight modification to reduce the dependency on other modules
class FileSuggest extends TextInputSuggest<TFile> {
    constructor(
        public app: App,
        public inputEl: HTMLInputElement,
        private plugin: MyPlugin,
    ) {
        super(app, inputEl);
    }

    getSuggestions(input_str: string): TFile[] {
        const all_files = Utils.getTfilesList(this.app, true);
        if (!all_files) {
            return [];
        }

        const files: TFile[] = [];
        const lower_input_str = input_str.toLowerCase();
        all_files.forEach((file: TAbstractFile) => {
            if (file instanceof TFile &&file.path.toLowerCase().contains(lower_input_str)) {
                files.push(file);
            }
        });
        return files;
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFile): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger("input");
        this.close();
    }
}

export class FolderSuggest extends TextInputSuggest<TFolder> {
	constructor(
        public app: App,
        public inputEl: HTMLInputElement,
    ) {
        super(app, inputEl);
    }
	getSuggestions(inputStr: string): TFolder[] {
		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const folders: TFolder[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		abstractFiles.forEach((folder: TAbstractFile) => {
			if (folder instanceof TFolder && folder.path.toLowerCase().contains(lowerCaseInputStr)) {
				folders.push(folder);
			}
		});
		return folders;
	}

	renderSuggestion(file: TFolder, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFolder): void {
		this.inputEl.value = file.path;
		this.inputEl.trigger("input");
		this.close();
	}
}

class Utils {
	// return sorted TFiles list
	static getTfilesList(app: App, markdownOnly: boolean): Array<TFile> {	
		const files: Array<TFile> = markdownOnly? app.vault.getMarkdownFiles() : app.vault.getFiles();
	
		files.sort((a, b) => {
			return a.path.localeCompare(b.path);
		});
		return files;
	}

	// check if object has zero element
	static isEmpty(obj:Object) {
		return Object.keys(obj).length == 0;
	}

	// check if file exist. easier to use in one line
	static fileExists(app: App, file:string):Promise<boolean>{
		let result = false;

		return new Promise((resolve, reject) => {
			app.vault.adapter.exists(file)
			.then((exists) => {
				if(exists)
					result = true;
				else{
					result = false;
				}	
			})
			.catch((err) => {
				console.error(err);
				result = false;
			})
			.finally(()=>{
				resolve(result);
			})
		});
	}
}