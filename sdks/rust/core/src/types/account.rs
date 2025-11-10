use crate::types::pubkey::Pubkey;

pub const TSDK_ACCOUNT_DATA_SZ_MAX: u64 = 16*1024*1024;

pub const TSDK_ACCOUNT_FLAG_PROGRAM: u8         = 0x01;
pub const TSDK_ACCOUNT_FLAG_PRIVILEGED: u8      = 0x02;
pub const TSDK_ACCOUNT_FLAG_UNCOMPRESSABLE: u8  = 0x04;
pub const TSDK_ACCOUNT_FLAG_EPHEMERAL: u8       = 0x08;
pub const TSDK_ACCOUNT_FLAG_DELETED: u8         = 0x10;
pub const TSDK_ACCOUNT_FLAG_NEW: u8             = 0x20;
pub const TSDK_ACCOUNT_FLAG_COMPRESSED: u8      = 0x40;
pub const TSDK_ACCOUNT_VERSION_V1: u8           = 0x01;

#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct AccountMeta {
    pub version: u8,
    pub flags: u8,
    pub data_sz: u32,
    pub seq: u64,
    pub owner: Pubkey,
    pub balance: u64,
    pub nonce: u64,
}

#[repr(C)]
#[derive(Debug)]
pub struct AccountInfoMut<'a> {
    pub meta: &'a AccountMeta,
    pub data: &'a mut [u8],
}

#[repr(C)]
#[derive(Debug)]
pub struct AccountInfo<'a> {
    pub meta: &'a AccountMeta,
    pub data: &'a [u8],
}

impl<'a> From<AccountInfoMut<'a>> for AccountInfo<'a> {
    fn from(value: AccountInfoMut<'a>) -> Self {
        AccountInfo {
            meta: value.meta,
            data: value.data,
        }
    }
}
