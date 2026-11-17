use super::*;

fn account(bytes: &[u8], flags: u8) -> thru_client::Account {
    thru_client::Account {
        balance: 0,
        data: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
        owner: Pubkey::from_bytes(&[1; 32]),
        flags,
        program: flags & 1 != 0,
        data_size: bytes.len() as u64,
        nonce: 0,
        seq: 0,
        is_new: flags & 32 != 0,
        is_ephemeral: flags & 8 != 0,
        is_deleted: flags & 16 != 0,
        is_privileged: flags & 2 != 0,
        slot: None,
        block_timestamp: None,
        version_seq: None,
        block_offset: None,
    }
}

fn meta_fixture(version: u64) -> (Vec<u8>, Value) {
    let mut bytes = vec![0; 74];
    bytes[0] = 1; /* TN_MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1 */
    bytes[1..33].fill(2);
    bytes[33..65].fill(3);
    bytes[65..73].copy_from_slice(&version.to_le_bytes());
    let expected = json!({"version":version.to_string(),"state":"open","authority":hex::encode([2;32]),"candidate":hex::encode([3;32])});
    (bytes, expected)
}

fn abi_fixture(revision: u64) -> (Vec<u8>, Value) {
    let mut bytes = vec![0; 46];
    bytes[0] = 2; /* TN_ABI_MANAGER_ACCOUNT_TYPE_CONTENT_V1 */
    bytes[1..33].fill(4);
    bytes[33..41].copy_from_slice(&revision.to_le_bytes());
    bytes[42..46].copy_from_slice(&3u32.to_le_bytes());
    bytes.extend(b"abi");
    let expected = json!({"metadata_address":hex::encode([4;32]),"revision":revision.to_string(),"state":"open","artifact":{"size":3,"sha256":digest(b"abi")}});
    (bytes, expected)
}

#[test]
fn reviewed_core_upgrade_rejects_stale_before_and_wrong_after_version() {
    let (before, expected_before) = meta_fixture(3);
    let (after, expected_after) = meta_fixture(4);
    let (raced, _) = meta_fixture(5);
    assert!(metadata(&before, &expected_before).is_ok());
    assert!(metadata(&after, &expected_before).is_err());
    assert!(metadata(&after, &expected_after).is_ok());
    assert!(metadata(&raced, &expected_after).is_err());
    let (_, max_expected) = meta_fixture(u64::MAX);
    assert!(metadata(&meta_fixture(u64::MAX).0, &max_expected).is_ok());
}

#[test]
fn reviewed_abi_upgrade_rejects_stale_before_and_wrong_after_revision() {
    let (before, expected_before) = abi_fixture(3);
    let (after, expected_after) = abi_fixture(4);
    let (raced, _) = abi_fixture(5);
    assert!(abi_content(&before, &expected_before).is_ok());
    assert!(abi_content(&after, &expected_before).is_err());
    assert!(abi_content(&after, &expected_after).is_ok());
    assert!(abi_content(&raced, &expected_after).is_err());
}

#[test]
fn reviewed_durable_accounts_require_exact_flags_owner_and_complete_data() {
    let owner = json!(hex::encode([1; 32]));
    for expected_flags in [0, 1, 4, 5, 8, 16, 32, 33, 36, 37] {
        for flags in 0..=u8::MAX {
            let live = account(b"image", flags);
            assert_eq!(
                account_data(&live, Some(&owner), Some(&json!(expected_flags)), "image").is_ok(),
                u64::from(flags) == expected_flags
            );
        }
    }
    let mut live = account(b"image", 5);
    live.owner = Pubkey::from_bytes(&[2; 32]);
    assert!(account_data(&live, Some(&owner), Some(&json!(5)), "image").is_err());
    live.owner = Pubkey::from_bytes(&[1; 32]);
    live.data_size += 1;
    assert!(account_data(&live, Some(&owner), Some(&json!(5)), "image").is_err());
    live.data = None;
    assert!(account_data(&live, Some(&owner), Some(&json!(5)), "image").is_err());
}

#[test]
fn compressed_live_data_is_rejected_even_without_reviewed_flags() {
    for bytes in [b"image".as_slice(), b"".as_slice()] {
        let live = account(bytes, TN_ACCOUNT_FLAG_COMPRESSED);
        for flags in [None, Some(json!(TN_ACCOUNT_FLAG_COMPRESSED))] {
            let error = account_data(&live, None, flags.as_ref(), "image").unwrap_err();
            assert!(error.to_string().contains("account data is compressed"));
        }
    }
    assert!(account_data(&account(b"image", 0), None, None, "image").is_ok());
}

#[test]
fn reviewed_authorities_lifecycle_links_and_artifacts_cannot_drift() {
    let (bytes, expected) = meta_fixture(3);
    for offset in [0, 1, 33, 73] {
        let mut wrong = bytes.clone();
        wrong[offset] ^= 1;
        assert!(metadata(&wrong, &expected).is_err());
    }
    assert!(metadata(&bytes[..73], &expected).is_err());
    let (bytes, expected) = abi_fixture(3);
    for offset in [0, 1, 33, 41, 42, 46] {
        let mut wrong = bytes.clone();
        wrong[offset] ^= 1;
        assert!(abi_content(&wrong, &expected).is_err());
    }
    let mut extra = bytes.clone();
    extra.push(0);
    assert!(abi_content(&extra, &expected).is_err());
    let expected_image = json!({"size":5,"sha256":digest(b"image")});
    assert!(artifact(b"image", &expected_image, "image").is_ok());
    assert!(artifact(b"imagh", &expected_image, "image").is_err());
    assert!(artifact(b"imag", &expected_image, "image").is_err());
    let mut abi_meta = vec![0; 100];
    abi_meta[0] = 1;
    abi_meta[4..36].fill(7);
    let subject = hex::encode([7; 32]);
    assert!(abi_metadata(&abi_meta, &subject).is_ok());
    for offset in [0, 1, 2, 3, 4] {
        let mut wrong = abi_meta.clone();
        wrong[offset] ^= 1;
        assert!(abi_metadata(&wrong, &subject).is_err());
    }
    assert!(abi_metadata(&abi_meta[..99], &subject).is_err());
}

#[test]
fn destroyed_and_closed_state_require_truncation_not_historical_headers() {
    let (bytes, mut expected) = meta_fixture(3);
    expected["state"] = json!("destroyed");
    assert!(metadata(&[], &expected).is_ok());
    assert!(metadata(&bytes, &expected).is_err());
    let (bytes, mut expected) = abi_fixture(3);
    expected["state"] = json!("closed");
    assert!(abi_content(&[], &expected).is_ok());
    assert!(abi_content(&bytes, &expected).is_err());
}

#[test]
fn flags_only_pin_does_not_invent_metadata_or_artifact_approval() {
    let live = account(b"unreviewed image", 5);
    assert!(account_data(&live, None, Some(&json!(5)), "image").is_ok());
    assert!(artifact(b"unreviewed image", &Value::Null, "image").is_ok());
    assert!(metadata(&[], &json!({"flags":4})).is_ok());
    let (bytes, _) = meta_fixture(99);
    assert!(metadata(&bytes, &json!({"state":"open"})).is_ok());
}

#[test]
fn creation_requires_absence_or_the_exact_reviewed_empty_corpse() {
    let owner = json!(hex::encode([1; 32]));
    assert!(check_creation(None, Some(&owner), Some(&json!(0)), "new").is_ok());
    assert!(check_creation(Some(&account(&[], 0)), Some(&owner), Some(&json!(0)), "new").is_err());
    assert!(
        check_creation(
            Some(&account(&[], 16)),
            Some(&owner),
            Some(&json!(0)),
            "new"
        )
        .is_err()
    );
    assert!(check_creation(None, Some(&owner), Some(&json!(16)), "corpse").is_err());
    let mut corpse = account(&[], 16);
    assert!(check_creation(Some(&corpse), Some(&owner), Some(&json!(16)), "corpse").is_ok());
    assert!(check_creation(Some(&corpse), None, Some(&json!(16)), "corpse").is_err());
    corpse.flags |= 4;
    assert!(check_creation(Some(&corpse), Some(&owner), Some(&json!(16)), "corpse").is_err());
    corpse.flags = 16;
    corpse.owner = Pubkey::from_bytes(&[2; 32]);
    assert!(check_creation(Some(&corpse), Some(&owner), Some(&json!(16)), "corpse").is_err());
    assert!(
        check_creation(
            Some(&account(b"not truncated", 16)),
            Some(&owner),
            Some(&json!(16)),
            "corpse"
        )
        .is_err()
    );
}

#[test]
fn terminal_deletion_accepts_only_reviewed_removable_absence_and_exact_corpses() {
    let owner = json!(hex::encode([1; 32]));
    for flags in [0, 4, 24, 28, 48, 52] {
        let reviewed_flags = json!(flags);
        let live = account(&[], flags);
        assert!(terminal_data(
            Some(&live),
            Some(&owner),
            Some(&reviewed_flags),
            true,
            "deleted"
        )
        .is_ok());
        assert_eq!(
            terminal_data(None, Some(&owner), Some(&reviewed_flags), true, "deleted").is_ok(),
            flags & 16 != 0
        );
        assert!(terminal_data(
            None,
            Some(&owner),
            Some(&reviewed_flags),
            false,
            "not terminal"
        )
        .is_err());
        for changed in [
            flags ^ 1,
            flags ^ 2,
            flags ^ 4,
            flags ^ 16,
            flags ^ 32,
            flags ^ 128,
        ] {
            assert!(terminal_data(
                Some(&account(&[], changed)),
                Some(&owner),
                Some(&reviewed_flags),
                true,
                "deleted"
            )
            .is_err());
        }
        let mut wrong_owner = live.clone();
        wrong_owner.owner = Pubkey::from_bytes(&[2; 32]);
        assert!(terminal_data(
            Some(&wrong_owner),
            Some(&owner),
            Some(&reviewed_flags),
            true,
            "deleted"
        )
        .is_err());
        let nonempty = terminal_data(
            Some(&account(b"resurrected", flags)),
            Some(&owner),
            Some(&reviewed_flags),
            true,
            "deleted",
        )
        .unwrap();
        assert!(metadata(&nonempty, &json!({"state":"destroyed"})).is_err());
        assert!(abi_content(&nonempty, &json!({"state":"closed"})).is_err());
    }
    for flags in [
        json!(-1),
        json!(256),
        json!(0.5),
        json!(16),
        json!(8),
        json!(32),
        json!(25),
        json!(88),
        json!(152),
    ] {
        assert!(terminal_data(None, Some(&owner), Some(&flags), true, "invalid corpse").is_err());
    }
    assert!(terminal_data(None, None, Some(&json!(24)), true, "unreviewed owner").is_err());
}

#[test]
fn validated_deletion_plans_compare_independent_runtime_endpoints_and_sealed_absence() {
    use thru_base::bootstrap_addresses::*;
    for abi in [false, true] {
        for (old, old_meta, new, new_meta) in [
            (4, 4, 4, 4),
            (8, 8, 24, 24),
            (32, 4, 48, 4),
            (4, 32, 4, 48),
            (160, 160, 48, 48),
        ] {
            let address = |n| hex::encode([n; 32]);
            let core_owner = hex::encode(CORE_MANAGER_PROGRAM_BYTES);
            let abi_owner = hex::encode(ABI_MANAGER_PROGRAM_BYTES);
            let mut before = json!({
                "identity":"subject","address":address(4),"owner":core_owner,"flags":if abi { 5 } else { old | 1 },
                "executable":{"path":"image.bin","size":5,"sha256":digest(b"image")},
                "metadata":{"address":address(3),"owner":core_owner,"flags":if abi { 4 } else { old_meta },"state":"open"}
            });
            if abi {
                before["abi"] = json!({"metadata_address":address(6),"content_address":address(7),"owner":abi_owner,
                    "metadata_flags":old_meta,"content_flags":old,"state":"finalized","revision":"3"});
            }
            let mut after = before.clone();
            if abi {
                after["abi"]["state"] = json!("closed");
                after["abi"]["content_flags"] = json!(new);
            } else {
                after["flags"] = json!(new);
                after["metadata"]["flags"] = json!(new_meta);
                after["metadata"]["state"] = json!("destroyed");
                after["executable"]["size"] = json!(0);
                after["executable"]["sha256"] = json!(digest(&[]));
            }
            let target = if abi {
                ABI_MANAGER_PROGRAM_BYTES
            } else {
                CORE_MANAGER_PROGRAM_BYTES
            };
            let mut rw = vec![CORE_CONFIG_BYTES];
            rw.extend((2..16).map(|n| [n; 32]));
            rw.sort();
            let mut ro = vec![target, MULTISIG_PROGRAM_BYTES];
            ro.sort();
            let plan = Plan::new(PlanInput {
                wrapper:hex::encode(MULTICALL_PROGRAM_BYTES), target_program:hex::encode(target),
                config:hex::encode(CORE_CONFIG_BYTES), admin:address(2), eoa_admin:false,
                accounts:Accounts { read_write:rw.iter().map(hex::encode).collect(), read_only:ro.iter().map(hex::encode).collect() },
                operation:if abi { Operation::Abi { action:AbiAction::Close, subject:address(4), program_metadata:Some(address(3)),
                    abi_metadata:address(6), abi_content:Some(address(7)), image:None, creation_proof:None } }
                    else { Operation::Destroy { metadata:address(3), program:address(4) } },
                reviewed_state:json!({"genesis_inventory_sha256":"a".repeat(64),"changes":[{"identity":"subject","before":before,"after":after}]}),
            }).unwrap();
            plan.validate().unwrap();
            let expected = &plan.input.reviewed_state["changes"][0]["after"];
            let endpoints = if abi {
                vec![(&expected["abi"], "content_flags", new)]
            } else {
                vec![
                    (expected, "flags", new),
                    (&expected["metadata"], "flags", new_meta),
                ]
            };
            for (record, flag_field, runtime_flags) in endpoints {
                let mut live = account(&[], runtime_flags);
                live.owner = Pubkey::from_bytes(&if abi {
                    ABI_MANAGER_PROGRAM_BYTES
                } else {
                    CORE_MANAGER_PROGRAM_BYTES
                });
                for sealed in [false, true] {
                    let observed = if sealed && runtime_flags & 16 != 0 {
                        None
                    } else {
                        Some(&live)
                    };
                    let bytes = terminal_data(
                        observed,
                        record.get("owner"),
                        record.get(flag_field),
                        true,
                        "terminal",
                    )
                    .unwrap();
                    if abi {
                        abi_content(&bytes, record).unwrap();
                    } else if record.get("metadata").is_some() {
                        artifact(&bytes, &record["executable"], "executable").unwrap();
                    } else {
                        metadata(&bytes, record).unwrap();
                    }
                }
                live.flags ^= 16;
                assert!(terminal_data(
                    Some(&live),
                    record.get("owner"),
                    record.get(flag_field),
                    true,
                    "resurrected"
                )
                .is_err());
            }
            if abi {
                // Content closure must never authorize disappearance of its metadata.
                assert!(terminal_data(
                    None,
                    expected["abi"].get("owner"),
                    expected["abi"].get("metadata_flags"),
                    false,
                    "ABI metadata"
                )
                .is_err());
            }
        }
    }
}

fn core_config(admin: u8, kind: u8, pending: Option<(u8, u8)>) -> thru_client::Account {
    let mut bytes = vec![0; 72];
    bytes[0] = 2; /* TN_CORE_MANAGER_ACCOUNT_TYPE_CONFIG_V1 */
    bytes[1] = kind;
    bytes[8..40].fill(admin);
    if let Some((pending_admin, pending_kind)) = pending {
        bytes[2] = pending_kind;
        bytes[3] = 1;
        bytes[40..].fill(pending_admin);
    }
    account(&bytes, 0)
}

fn core_roles_fixture(admin: u8, kind: &str, pending: Option<(u8, &str)>) -> Value {
    let (pending_admin, pending_kind) = match pending {
        Some((byte, kind)) => (hex::encode([byte; 32]), kind),
        None => ("00".repeat(32), "none"),
    };
    json!({"admin":hex::encode([admin;32]),"kind":kind,"pending_admin":pending_admin,"pending_kind":pending_kind})
}

#[test]
fn rotation_roles_match_live_core_config_before_and_after() {
    // ProposeAdmin: before has no pending admin, after has the candidate pending.
    let before = core_roles_fixture(2, "eoa", None);
    let after = core_roles_fixture(2, "eoa", Some((9, "multisig")));
    assert!(core_roles(Some(&core_config(2, 1, None)), &before).is_ok());
    assert!(core_roles(Some(&core_config(2, 1, Some((9, 2)))), &after).is_ok());
    assert!(core_roles(Some(&core_config(2, 1, Some((9, 2)))), &before).is_err());
    assert!(core_roles(Some(&core_config(2, 1, None)), &after).is_err());
}

#[test]
fn rotation_rejects_live_core_config_drift() {
    let roles = core_roles_fixture(2, "eoa", None);
    let message = |live: Option<&thru_client::Account>, roles: &Value| {
        core_roles(live, roles).unwrap_err().to_string()
    };
    // A pending admin injected after review.
    assert!(
        message(Some(&core_config(2, 1, Some((7, 1)))), &roles).contains("pending admin differs")
    );
    // A different pending admin than the reviewed one.
    let pending = core_roles_fixture(2, "eoa", Some((9, "eoa")));
    assert!(
        message(Some(&core_config(2, 1, Some((8, 1)))), &pending).contains("pending admin differs")
    );
    assert!(
        message(Some(&core_config(2, 1, Some((9, 2)))), &pending)
            .contains("pending admin kind differs")
    );
    assert!(message(Some(&core_config(3, 1, None)), &roles).contains("admin differs"));
    assert!(message(Some(&core_config(2, 2, None)), &roles).contains("admin kind differs"));
    assert!(message(None, &roles).contains("Core config account missing"));
    let mut missing = roles.clone();
    missing["pending_kind"] = Value::Null;
    assert!(
        message(Some(&core_config(2, 1, None)), &missing)
            .contains("missing reviewed Core role pending_kind")
    );
}
