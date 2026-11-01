import {expect,type Page} from '@playwright/test'
export async function multiplayerMode(page:Page){await page.getByRole('button',{name:'Table mode',exact:true}).click();await page.getByRole('menuitem',{name:'Multiplayer',exact:true}).click()}
export async function library(page:Page,name='Combatant Library'){await closeSetup(page);await page.getByRole('button',{name:'Libraries',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click()}
export async function sessionAction(page:Page,name:string){await closeSetup(page);if(name==='End session')page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Session',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click()}
export async function openSetup(page:Page){if(!await page.getByRole('dialog',{name:'Campaign setup',exact:true}).isVisible())await sessionAction(page,'Campaign and encounter setup');await expect(page.getByRole('dialog',{name:'Campaign setup',exact:true})).toBeVisible()}
export async function closeSetup(page:Page){const dialog=page.getByRole('dialog',{name:'Campaign setup',exact:true});if(await dialog.isVisible())await dialog.getByRole('button',{name:'Close Campaign setup',exact:true}).click()}
export async function combatantAction(page:Page,name:string){await page.getByRole('button',{name:'Combatant actions',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click()}

export async function chooseCampaign(page:Page,value:string|{label:string}){await expect(page.getByRole('combobox',{name:'Campaign',exact:true})).toBeEnabled();await closeSetup(page);await page.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(value)}
